const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { hashToken } = require("../utils/crypto");

const router = express.Router();
const isProd = process.env.NODE_ENV === "production";

function generateAccessToken(userId, username, role) {
  return jwt.sign(
    { id: userId, username, role, type: "access" },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );
}

router.post("/", async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  
  if (!refreshToken) {
    return res.status(401).json({ message: "No refresh token" });
  }

  try {
    const decoded = jwt.verify(
      refreshToken,
      process.env.REFRESH_TOKEN_SECRET
    );

    if (decoded.type !== "refresh") {
      return res.status(401).json({ message: "Invalid token type" });
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    const hashedRefresh = hashToken(refreshToken);

    const tokenIndex = user.refreshTokens.findIndex(
      t => t.tokenHash === hashedRefresh
    );

    // 🔥 REUSE DETECTION
    if (tokenIndex === -1) {
      user.refreshTokens = [];
      await user.save();

      return res.status(401).json({
        message: "Token reuse detected. Logged out everywhere.",
        code: "TOKEN_REUSE_DETECTED"
      });
    }

    // 🔁 REMOVE OLD TOKEN
    user.refreshTokens.splice(tokenIndex, 1);

    // 🔁 CREATE NEW REFRESH TOKEN
    const newRefreshToken = jwt.sign(
      { id: user._id, type: "refresh" },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: "90d" }
    );

    user.refreshTokens.push({
      tokenHash: hashToken(newRefreshToken),
      device: req.headers["user-agent"] || "web",
    });

    await user.save();

    const newAccessToken = generateAccessToken(
      user._id,
      user.username,
      user.role
    );

    const cookieOptions = {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "None" : "Lax",
      path: "/",
    };

    res.cookie("accessToken", newAccessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000,
    });

    res.cookie("refreshToken", newRefreshToken, {
      ...cookieOptions,
      maxAge: 90 * 24 * 60 * 60 * 1000,
    });

    return res.json({ message: "Token rotated successfully" });

  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        message: "Refresh token expired",
        code: "REFRESH_TOKEN_EXPIRED"
      });
    }
    
    return res.status(401).json({ message: "Invalid or expired refresh token" });
  }
});


module.exports = router;
