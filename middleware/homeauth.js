const jwt = require("jsonwebtoken");

const homeAuth = (req, res, next) => {
  try {
    const token = req.cookies.accessToken;

    if (!token) {
      return res.status(401).json({ message: "No access token in cookies" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = {
      id: decoded.id,
      username: decoded.username,
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      // Access token expired, client should auto-refresh
      return res.status(401).json({ message: "Token expired", code: "TOKEN_EXPIRED" });
    }
    return res.status(401).json({ message: "Access token expired or invalid" });
  }
};

module.exports = homeAuth;
