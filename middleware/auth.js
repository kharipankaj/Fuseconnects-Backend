const jwt = require("jsonwebtoken");
const User = require("../models/User");

module.exports = async function (req, res, next) {
  const accessToken = req.cookies.accessToken;

  if (!accessToken) {
    console.log("🔴 Auth failed: No access token in cookies");
    return res.status(401).json({ message: "No token, authorization denied" });
  }

  try {
    // Verify JWT signature and expiry
    const decoded = jwt.verify(accessToken, process.env.JWT_SECRET);
    
    // Validate token type
    if (decoded.type !== "access") {
      console.log("🔴 Auth failed: Invalid token type:", decoded.type);
      return res.status(401).json({ message: "Invalid token type" });
    }

    // Fetch fresh user data from DB to get latest role
    const user = await User.findById(decoded.id).select('role username');
    if (!user) {
      console.log("🔴 Auth failed: User not found in DB for ID:", decoded.id);
      return res.status(401).json({ message: "User not found" });
    }
    
    req.user = { 
      id: decoded.id, 
      username: user.username, 
      role: user.role 
    };
    
    next();
    
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        message: "Token expired",
        code: "TOKEN_EXPIRED"
      });
    }
    
    res.status(401).json({ message: "Token is not valid" });
  }

};