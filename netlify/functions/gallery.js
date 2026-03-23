exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "text/plain" },
      body: "Method Not Allowed"
    };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html" },
    body: '<img src="images/project1/test.jpg" alt="image gallery" class="carousel-slide">'
  };
};