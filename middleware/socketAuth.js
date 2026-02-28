// middleware/socketAuth.js
const jwt = require("jsonwebtoken");
const cookie = require("cookie");

module.exports = function socketAuth(socket, next) {
  const normalizeDecodedUser = (decoded) => {
    const normalizedId =
      decoded?.id ||
      decoded?.userId ||
      decoded?._id ||
      decoded?.sub ||
      decoded?.uid ||
      decoded?.user?.id ||
      decoded?.user?._id ||
      null;
    const normalizedUsername =
      decoded?.username ||
      decoded?.user?.username ||
      decoded?.name ||
      null;

    return {
      ...decoded,
      id: normalizedId,
      username: normalizedUsername,
    };
  };

  try {
    const cookieHeader = socket.handshake.headers.cookie || "";
    const cookies = cookieHeader ? cookie.parse(cookieHeader) : {};
    const bearer = socket.handshake.headers.authorization || "";
    const bearerToken = bearer.startsWith("Bearer ") ? bearer.slice(7) : null;
    const rawAuthToken = socket.handshake.auth?.token || null;
    const authToken =
      typeof rawAuthToken === "string" && rawAuthToken.startsWith("Bearer ")
        ? rawAuthToken.slice(7)
        : rawAuthToken;
    const tokenCandidates = [authToken, bearerToken, cookies.accessToken]
      .filter((t) => typeof t === "string" && t.trim().length > 0);

    // Allow anonymous socket connections when auth token is not present.
    if (!tokenCandidates.length) {
      socket.user = null;
      return next();
    }

    for (const token of tokenCandidates) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.user = normalizeDecodedUser(decoded);
        return next();
      } catch (verifyErr) {
        try {
          // Fallback for expired access tokens; signature still verified.
          const decodedIgnoringExp = jwt.verify(token, process.env.JWT_SECRET, {
            ignoreExpiration: true,
          });
          socket.user = normalizeDecodedUser(decodedIgnoringExp);
          return next();
        } catch {
          // Try next token candidate.
        }
      }
    }

    socket.user = null;
    return next();
  } catch (err) {
    socket.user = null;
    return next();
  }
};
