// middleware/socketAuth.js
const jwt = require("jsonwebtoken");
const cookie = require("cookie");

module.exports = function socketAuth(socket, next) {
  try {
    const cookieHeader = socket.handshake.headers.cookie;

    if (!cookieHeader) {
      return next(new Error("No token, authorization denied"));
    }

    const cookies = cookie.parse(cookieHeader);
    const accessToken = cookies.accessToken;

    if (!accessToken) {
      return next(new Error("No token, authorization denied"));
    }

    const decoded = jwt.verify(accessToken, process.env.JWT_SECRET);

    socket.user = decoded;

    next(); // allow connection
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return next(new Error("TOKEN_EXPIRED"));
    }
    next(new Error("Token is not valid"));
  }
};
