const jwt = require("jsonwebtoken");
const User = require("../models/User");

module.exports = async function (req, res, next) {
  if (req.method === 'OPTIONS') return next();
  let token;
  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  } else {
    token = req.cookies?.accessToken;
  }

  if (!token) {
    if (process.env.NODE_ENV !== 'production') {
      console.log("🔴 Auth failed: No access token provided");
      console.log("   Available cookies:", Object.keys(req.cookies || {}));
    }
    return res.status(401).json({ message: "No token, authorization denied" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (process.env.NODE_ENV !== 'production') console.log(`🔵 Token verified for user: ${decoded.username || decoded.id}`);

    if (decoded.type !== "access") {
      console.log("🔴 Auth failed: Invalid token type:", decoded.type);
      return res.status(401).json({ message: "Invalid token type" });
    }

    const user = await User.findById(decoded.id).select('role username');
    if (!user) {
      if (process.env.NODE_ENV !== 'production') console.log("🔴 Auth failed: User not found in DB for ID:", decoded.id);
      return res.status(401).json({ message: "User not found" });
    }
    if (process.env.NODE_ENV !== 'production') console.log(`   DB role (fresh): ${user.role}`);

    req.user = {
      id: decoded.id,
      username: user.username,
      role: user.role,
    };

    if (process.env.NODE_ENV !== 'production') console.log(`✅ Auth success: ${user.username} (${user.role})`);
    return next();

  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        message: "Access token expired",
        code: "ACCESS_TOKEN_EXPIRED"
      });
    }

    console.log("🔴 Auth failed: Token verification error", err.message);
    return res.status(401).json({ message: "Token is not valid" });
  }
};