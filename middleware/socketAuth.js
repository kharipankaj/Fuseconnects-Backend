// middleware/socketAuth.js
const jwt = require("jsonwebtoken");
const cookie = require("cookie");

module.exports = function socketAuth(socket, next) {
  try {
    const cookieHeader = socket.handshake.headers.cookie || "";
    const cookies = cookieHeader ? cookie.parse(cookieHeader) : {};
    const accessToken = cookies.accessToken;

    // Allow anonymous socket connections when no auth cookie is present.
    if (!accessToken) {
      socket.user = null;
      return next();
    }

    const decoded = jwt.verify(accessToken, process.env.JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return next(new Error("TOKEN_EXPIRED"));
    }
    next(new Error("Token is not valid"));
  }
};
