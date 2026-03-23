const fs = require("fs");
const path = require("path");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "text/plain" },
      body: "Method Not Allowed"
    };
  }

  try {
    const folderPath = path.join(process.cwd(), "images", "project1");
    const files = fs.readdirSync(folderPath);

    const allowedExtensions = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

    const html = files
      .filter((file) => {
        const ext = path.extname(file).toLowerCase();
        return allowedExtensions.includes(ext);
      })
      .map((file) => {
        return `<img src="images/project1/${file}" alt="image gallery" class="carousel-slide">`;
      })
      .join("\n");

    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html" },
      body: html
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "text/plain" },
      body: `Error reading gallery folder: ${error.message}`
    };
  }
};