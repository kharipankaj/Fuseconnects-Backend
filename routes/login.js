const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { hashToken } = require("../utils/crypto");

const router = express.Router();
const isProd = process.env.NODE_ENV === "production";

// Validate environment variables at startup
if (!process.env.JWT_SECRET) {
  console.error("❌ FATAL: JWT_SECRET not set in environment variables");
}
if (!process.env.REFRESH_TOKEN_SECRET) {
  console.error("❌ FATAL: REFRESH_TOKEN_SECRET not set in environment variables");
}


function generateAccessToken(userId, username, role) {
  return jwt.sign(
    {
      id: userId,
      username,
      role,
      type: "access",
    },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );
}

function generateRefreshToken(userId) {
  return jwt.sign(
    {
      id: userId,
      type: "refresh",
    },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: "90d" }
  );
}


router.post("/", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: "Username and password required" });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ message: "Incorrect username or password" });
    }

    // Previously required email verification here; authentication now allowed regardless of verification status

    const isValid = await user.comparePassword(password);
    if (!isValid) {
      return res.status(400).json({ message: "Incorrect username or password" });
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log(new Date().toISOString(), `✅ Login successful for user: ${username}`, {
        origin: req.headers.origin || null,
        userAgent: req.headers['user-agent'] || null,
      });
    }

    const accessToken = generateAccessToken(
      user._id,
      user.username,
      user.role
    );

    const refreshToken = generateRefreshToken(user._id);

    user.refreshTokens = user.refreshTokens.filter(t => t.tokenHash);
    // Ensure only one refresh token per device: replace if device exists
    const deviceId = (req.headers["x-device-id"] || req.headers["user-agent"] || "web").toString();
    const existingIndex = user.refreshTokens.findIndex(t => t.device === deviceId);
    const newTokenEntry = {
      tokenHash: hashToken(refreshToken),
      device: deviceId,
    };
    if (existingIndex !== -1) {
      user.refreshTokens[existingIndex] = newTokenEntry;
    } else {
      user.refreshTokens.push(newTokenEntry);
    }

    user.tokenLastRefreshedAt = new Date();
    await user.save();

    if (process.env.NODE_ENV !== 'production') {
      console.log(new Date().toISOString(), `🔐 Stored refresh token for user: ${username}`, {
        refreshTokensCount: user.refreshTokens.length,
        device: req.headers['user-agent'] || 'web',
      });
    }

    const cookieOptions = {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "None" : "Lax",
      path: "/",
    };

    // Return access token in response body (client will store/send in Authorization header)
    res.cookie("refreshToken", refreshToken, {
      ...cookieOptions,
      maxAge: 90 * 24 * 60 * 60 * 1000, // 90 days
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log(new Date().toISOString(), `🍪 Sent refresh cookie for user: ${username}`, {
        secure: isProd,
        sameSite: cookieOptions.sameSite,
      });

      console.log(`🍪 Cookies set for user: ${username} (mode: ${isProd ? 'PROD' : 'DEV'})`);
    }

    /* 8️⃣ Send safe response */
    res.json({
      message: "Login successful",
      accessToken,
      user: {
        id: user._id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    });

    if (process.env.NODE_ENV !== 'production') console.log(new Date().toISOString(), `✅ Login response sent for user: ${username}`);

  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ message: "Server error. Please try again." });
  }
});

module.exports = router;
