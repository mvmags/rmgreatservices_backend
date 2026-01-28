// netlify/functions/contact.js

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CONTACT_TO_EMAIL = process.env.CONTACT_TO_EMAIL; // where you receive messages
const CONTACT_FROM_EMAIL = process.env.CONTACT_FROM_EMAIL; // must be verified in Resend
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY; // optional but recommended

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      // Basic CORS (adjust if you need)
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    },
    body: JSON.stringify(body)
  };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

async function verifyTurnstile(token, ip) {
  if (!TURNSTILE_SECRET_KEY) return { ok: true, skipped: true };
  if (!token) return { ok: false, reason: "Missing captchaToken" };

  const form = new URLSearchParams();
  form.set("secret", TURNSTILE_SECRET_KEY);
  form.set("response", token);
  if (ip) form.set("remoteip", ip);

  const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString()
  });

  const data = await resp.json();
  return { ok: !!data.success, data };
}

async function sendWithResend({ name, email, subject, phone, message }) {
  if (!RESEND_API_KEY) throw new Error("Missing RESEND_API_KEY");
  if (!CONTACT_TO_EMAIL) throw new Error("Missing CONTACT_TO_EMAIL");
  if (!CONTACT_FROM_EMAIL) throw new Error("Missing CONTACT_FROM_EMAIL");

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
    throw new Error(`Resend error ${resp.status}: ${errText}`);
  }

  return resp.json();
}

exports.handler = async (event) => {
  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return json(204, {});
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method Not Allowed" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim();
  const message = String(body.message || "").trim();
  const subject = body.subject ? String(body.subject).trim() : "";
  const phone = body.phone ? String(body.phone).trim() : "";

  // Honeypot: your form includes a hidden field named "website"
  // Real users keep it empty; many bots fill it.
  const honeypot = String(body.website || "").trim();
  if (honeypot) {
    // Pretend success to avoid teaching bots
    return json(200, { success: true });
  }

  // Basic validation
  if (!name || !email || !message) {
    return json(400, { error: "Missing required fields: name, email, message" });
  }
  if (!isValidEmail(email)) {
    return json(400, { error: "Invalid email format" });
  }
  if (message.length > 5000) {
    return json(400, { error: "Message too long" });
  }

  // CAPTCHA (Turnstile) server-side verification
  const captchaToken = body.captchaToken ? String(body.captchaToken) : "";
  const ip = event.headers["x-nf-client-connection-ip"] || event.headers["client-ip"] || "";
  const captcha = await verifyTurnstile(captchaToken, ip);
  if (!captcha.ok) {
    return json(400, { error: "Captcha failed" });
  }

  // Send email
  try {
    const result = await sendWithResend({ name, email, subject, phone, message });
    return json(200, { success: true, id: result.id || null });
  } catch (err) {
    return json(500, { error: "Email send failed" });
  }
};
