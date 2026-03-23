const jwt = require("jsonwebtoken");

module.exports = function (req, res, next) {
  try {
    const token = req.cookies?.accessToken;

    if (!token) {
      return res.status(401).json({
        message: "No access token cookie",
        code: "NO_TOKEN"
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = {
      userId: decoded.userId || decoded.id,
      username: decoded.username,
      role: decoded.role || 'user',
    };

    next();
    
  } catch (err) {
    return res.status(401).json({
      message: "Token invalid/expired",
      code: "ACCESS_TOKEN_EXPIRED",
      error: err.message.includes('expired') ? 'expired' : 'invalid'
    });
  }
};
