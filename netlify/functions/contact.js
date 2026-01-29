// netlify/functions/contact.js

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CONTACT_TO_EMAIL = process.env.CONTACT_TO_EMAIL; // where you receive messages
const CONTACT_FROM_EMAIL = process.env.CONTACT_FROM_EMAIL; // must be verified in Resend

const ALLOWED_ORIGINS = new Set([
  "https://rml230878.github.io/rmgreatservices/",
  "https://rmgreatservices.com",
  "https://www.rmgreatservices.com"
]);

function newRequestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function log(level, eventName, details = {}) {
  // Netlify captures stdout/stderr, so console.log works.
  // Use JSON logs so you can search by fields.
  const entry = {
    ts: new Date().toISOString(),
    level,              // "info" | "warn" | "error"
    event: eventName,   // e.g. "contact.received"
    ...details
  };

  if (level === "error") console.error(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

function maskEmail(email) {
  const e = String(email || "");
  const at = e.indexOf("@");
  if (at <= 1) return "***";
  return e.slice(0, 2) + "***" + e.slice(at);
}

function getClientIp(event) {
  return (
    event.headers["x-nf-client-connection-ip"] ||
    event.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    event.headers["client-ip"] ||
    ""
  );
}

function accessControlAllowOriginValue(origin) {
  const ok = origin && ALLOWED_ORIGINS.has(origin);
  return ok ? origin : "null";
}

function corsHeaders(origin) {
  const ok = origin && ALLOWED_ORIGINS.has(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : "null",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(statusCode, body, origin) {
  log(
    "info",
    "json.generate",
    {
        statusCode,
        isBody: body ? true : false,
        origin: origin || ""
    }
  );

  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      // Basic CORS (adjust if you need)
      ...corsHeaders(origin)
    },
    body: JSON.stringify(body)
  };

//   return {
//     statusCode,
//     headers: {
//       "Content-Type": "application/json",
//       // Basic CORS (adjust if you need)
//       "Access-Control-Allow-Origin": "*",
//       "Access-Control-Allow-Headers": "Content-Type",
//       "Access-Control-Allow-Methods": "POST, OPTIONS"
//     },
//     body: JSON.stringify(body)
//   };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

async function sendWithResend({ name, email, subject, phone, message }) {
    
  if (!RESEND_API_KEY) {
    log("error", "contact.missing_config", { missing: "RESEND_API_KEY" });
    throw new Error("Missing RESEND_API_KEY");
  }
  if (!CONTACT_TO_EMAIL) {
    log("error", "contact.missing_config", { missing: "CONTACT_TO_EMAIL" });
    throw new Error("Missing CONTACT_TO_EMAIL");
  }
  if (!CONTACT_FROM_EMAIL) {
    log("error", "contact.missing_config", { missing: "CONTACT_FROM_EMAIL" });
    throw new Error("Missing CONTACT_FROM_EMAIL");
  }

  const safeSubject = subject?.trim() ? subject.trim() : "New contact form message";

  const text =
`New contact form submission

Name: ${name}
Email: ${email}
Phone: ${phone || "-"}
Subject: ${safeSubject}

Message:
${message}
`;

  const payload = {
    from: CONTACT_FROM_EMAIL,
    to: [CONTACT_TO_EMAIL],
    reply_to: email, // so you can reply directly
    subject: `[Contact] ${safeSubject}`,
    text
  };

  log("info", "contact.sending_email", {
    to: CONTACT_TO_EMAIL,
    from: CONTACT_FROM_EMAIL,
    reply_to: email,
    subject: payload.subject,
    textLen: text.length
  });

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const errText = await resp.text();
    log("error", "contact.resend_error", {
        status: resp.status,
        textError: errText
    });
    throw new Error(`Resend error ${resp.status}: ${errText}`);
  }

  return resp.json();
}

exports.handler = async (event) => {
  const origin = event.headers?.origin || "";
  const reqId = newRequestId();
  const ip = getClientIp(event);

  log("info", "contact.request", {
    reqId,
    method: event.httpMethod,
    origin,
    ip,
    path: event.path
  });

  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return json(
        204,
        {},
        origin
    );
  }

  if (event.httpMethod !== "POST") {
    return json(
        405,
        { error: "Method Not Allowed" },
        origin
    );
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(
        400,
        { error: "Invalid JSON" },
        origin
    );
  }

  // TODO: remove this line after testing
  log("debug", "request.body", {
    reqId,
    method: event.httpMethod,
    origin,
    ip,
    path: event.path,
    body
  });

  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim();
  const message = String(body.message || "").trim();
  const subject = body.subject ? String(body.subject).trim() : "";
  const phone = body.phone ? String(body.phone).trim() : "";

  // Honeypot: your form includes a hidden field named "website"
  // Real users keep it empty; many bots fill it.
  const honeypot = String(body.website || "").trim();
  if (honeypot) {
    log("warn", "contact.honeypot_hit", { reqId, ip, origin });

    // Pretend success to avoid teaching bots
    return json(
        200,
        { success: true },
        origin
    );
  }

  // Basic validation
  if (!name || !email || !message) {
    log("warn", "contact.validation_failed", {
        reqId,
        ip,
        origin,
        reason: "missing_fields" // or "invalid_email", etc.
    });
    return json(400, { error: "Missing required fields: name, email, message" });
  }
  if (!isValidEmail(email)) {
    log("warn", "contact.validation_failed", {
        reqId,
        ip,
        origin,
        reason: "invalid_email" // or "invalid_email", etc.
    });
    return json(400, { error: "Invalid email format" });
  }
  if (message.length > 5000) {
    log("warn", "contact.validation_failed", {
        reqId,
        ip,
        origin,
        reason: "message_too_long" // or "invalid_email", etc.
    });
    return json(400, { error: "Message too long" });
  }

  log("info", "contact.received", {
    reqId,
    ip,
    origin,
    nameLen: name.length,
    emailMasked: maskEmail(email),
    subjectLen: subject.length,
    messageLen: message.length
  });

  // Send email
  try {
    const result = await sendWithResend({ name, email, subject, phone, message });
    return json(200, { success: true, id: result.id || null }, origin);
  } catch (err) {
    return json(500, { error: "Email send failed" });
  }
};
