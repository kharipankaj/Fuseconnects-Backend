const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { hashToken } = require("../utils/crypto");

const router = express.Router();
const isProd = process.env.NODE_ENV === "production";

router.post("/single", async (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) {
    return res.status(400).json({ message: "No refresh token provided" });
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
      return res.status(400).json({ message: "Invalid user" });
    }

    const hashed = hashToken(refreshToken);

    user.refreshTokens = user.refreshTokens.filter(
      t => t.tokenHash !== hashed
    );

    await user.save();

    const clearOptions = {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "None" : "Lax",
      path: "/",
    };

    res.clearCookie("refreshToken", clearOptions);
    res.clearCookie("accessToken", clearOptions);

    return res.json({ message: "Logged out from current device" });

  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired refresh token" });
  }
});

router.post("/all", async (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) {
    return res.status(400).json({ message: "No refresh token provided" });
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
      return res.status(400).json({ message: "Invalid user" });
    }

    user.refreshTokens = [];
    await user.save();

    const clearOptions = {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "None" : "Lax",
      path: "/",
    };

    res.clearCookie("refreshToken", clearOptions);
    res.clearCookie("accessToken", clearOptions);

    return res.json({ message: "Logged out from all devices" });

  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired refresh token" });
  }
});

module.exports = router;
