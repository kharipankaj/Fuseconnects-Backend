const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { hashToken } = require("../utils/crypto");

const router = express.Router();
const isProd = process.env.NODE_ENV === "production";

// ✅ DEV COOKIE FIX - Force cross-origin for localhost
const DEV_CORS_COOKIE = !isProd;

// ENV check
if (!process.env.JWT_SECRET || !process.env.REFRESH_TOKEN_SECRET) {
  console.error("❌ JWT secrets missing in .env");
}

// 🔐 Access Token
function generateAccessToken(user) {
  return jwt.sign(
    {
      id: user._id,
      username: user.username,
      role: user.role,
      type: "access",
    },
    process.env.JWT_SECRET,
{ expiresIn: "7d" }
  );
}

// 🔐 Refresh Token
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

// 📱 Mobile normalize
function normalizeMobile(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return null;
}

// 🔍 Find user
async function findUserByIdentifier(identifier) {
  const raw = String(identifier || "").trim();
  if (!raw) return null;

  const queries = [
    { username: raw },
    { username: { $regex: new RegExp(`^${raw}$`, "i") } },
  ];

  if (raw.includes("@")) {
    queries.push({ email: raw.toLowerCase() });
  }

  const mobile = normalizeMobile(raw);
  if (mobile) {
    queries.push({ mobile });
  }

  return User.findOne({ $or: queries });
}

// 🔍 Account suggestions
router.post("/accounts", async (req, res) => {
  try {
    const identifier = String(req.body?.identifier || "").trim();

    if (!identifier) {
      return res.status(400).json({ message: "Identifier required" });
    }

    const queries = [];

    if (identifier.includes("@")) {
      queries.push({ email: identifier.toLowerCase() });
    }

    const mobile = normalizeMobile(identifier);
    if (mobile) {
      queries.push({ mobile });
    }

    const users = await User.find({ $or: queries })
      .select("_id username firstName lastName displayPicture")
      .limit(10);

    res.json({
      accounts: users.map((u) => ({
        id: u._id,
        username: u.username,
        firstName: u.firstName,
        lastName: u.lastName || "",
        displayPicture: u.displayPicture || "",
      })),
    });

  } catch (err) {
    console.error("Account lookup error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// 🔑 LOGIN
router.post("/", async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ message: "Identifier and password required" });
    }

    const user = await User.findOne({ username: identifier.toLowerCase().trim() }).select('+password');
    if (!user) {
      return res.status(400).json({ message: "Incorrect credentials" });
    }

    const isValid = await user.comparePassword(password);
    if (!isValid || !password) {
      return res.status(400).json({ message: "Incorrect credentials" });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user._id);

    const deviceId =
      req.headers["x-device-id"] ||
      req.headers["user-agent"] ||
      "web";

    user.refreshTokens = user.refreshTokens.filter((t) => t.tokenHash);

    const existingIndex = user.refreshTokens.findIndex(
      (t) => t.device === deviceId
    );

    const newToken = {
      tokenHash: hashToken(refreshToken),
      device: deviceId,
    };

    if (existingIndex !== -1) {
      user.refreshTokens[existingIndex] = newToken;
    } else {
      user.refreshTokens.push(newToken);
    }

    user.tokenLastRefreshedAt = new Date();
    await user.save();

// ✅ FIXED: Single consistent cookie setting with logging
    console.log('🔐 LOGIN: Setting cookies for', user.username);
    console.log('   accessToken length:', accessToken.length);
    console.log('   sameSite policy:', isProd ? 'none' : 'none'); // Force none for dev cross-origin
    
    const cookieOptions = {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax', // lax dev localhost, none prod
maxAge: 7 * 24 * 60 * 60 * 1000
    };
    
    const refreshOptions = {
      ...cookieOptions,
      maxAge: 90 * 24 * 60 * 60 * 1000
    };
    
    res.cookie('accessToken', accessToken, cookieOptions);
    res.cookie('refreshToken', refreshToken, refreshOptions);
    
    console.log('✅ Cookies set successfully');

    // Single JSON response for sessionStorage
    res.json({
      success: true,
      message: 'Login successful',
      accessToken,  // Frontend sessionStorage
      sessionToken: accessToken
    });

  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;