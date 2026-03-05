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

function normalizeMobile(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return null;
}

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

router.post("/accounts", async (req, res) => {
  try {
    const identifier = String(req.body?.identifier || "").trim();
    if (!identifier) {
      return res.status(400).json({ message: "Email or phone number is required" });
    }

    const queries = [];
    const maybeEmail = identifier.toLowerCase();
    if (maybeEmail.includes("@")) {
      queries.push({ email: maybeEmail });
    }

    const mobile = normalizeMobile(identifier);
    if (mobile) {
      queries.push({ mobile });
    }

    if (!queries.length) {
      return res.status(400).json({ message: "Enter a valid email or phone number" });
    }

    const users = await User.find({ $or: queries })
      .select("_id username firstName lastName displayPicture")
      .limit(10);

    return res.json({
      accounts: users.map((user) => ({
        id: user._id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName || "",
        displayPicture: user.displayPicture || "",
      })),
    });
  } catch (err) {
    console.error("Account lookup error:", err);
    return res.status(500).json({ message: "Server error. Please try again." });
  }
});


router.post("/", async (req, res) => {
  try {
    const { username, identifier, password } = req.body;
    const loginIdentifier = String(identifier || username || "").trim();

    if (!loginIdentifier || !password) {
      return res.status(400).json({ message: "Identifier and password required" });
    }

    const user = await findUserByIdentifier(loginIdentifier);
    if (!user) {
      return res.status(400).json({ message: "Incorrect credentials" });
    }

    // Previously required email verification here; authentication now allowed regardless of verification status

    const isValid = await user.comparePassword(password);
    if (!isValid) {
      return res.status(400).json({ message: "Incorrect credentials" });
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log(new Date().toISOString(), `✅ Login successful for user: ${user.username}`, {
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
      console.log(new Date().toISOString(), `🔐 Stored refresh token for user: ${user.username}`, {
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
      console.log(new Date().toISOString(), `🍪 Sent refresh cookie for user: ${user.username}`, {
        secure: isProd,
        sameSite: cookieOptions.sameSite,
      });

      console.log(`🍪 Cookies set for user: ${user.username} (mode: ${isProd ? 'PROD' : 'DEV'})`);
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

    if (process.env.NODE_ENV !== 'production') console.log(new Date().toISOString(), `✅ Login response sent for user: ${user.username}`);

  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ message: "Server error. Please try again." });
  }
});

module.exports = router;
