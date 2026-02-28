// middleware/socketAuth.js
const jwt = require("jsonwebtoken");
const cookie = require("cookie");

module.exports = function socketAuth(socket, next) {
  try {
    const cookieHeader = socket.handshake.headers.cookie || "";
    const cookies = cookieHeader ? cookie.parse(cookieHeader) : {};
    const bearer = socket.handshake.headers.authorization || "";
    const bearerToken = bearer.startsWith("Bearer ") ? bearer.slice(7) : null;
    const authToken = socket.handshake.auth?.token || null;
    const accessToken = cookies.accessToken || authToken || bearerToken;

    // Allow anonymous socket connections when auth token is not present.
    if (!accessToken) {
      socket.user = null;
      return next();
    }

    const decoded = jwt.verify(accessToken, process.env.JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    socket.user = null;
    next();
  }
};
