const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const User = require('../models/User');
const { hashToken } = require('../utils/crypto');

const isProd = process.env.NODE_ENV === "production";

// Generate short-lived access token (15 minutes)
function generateAccessToken(userId, username) {
  return jwt.sign(
    { id: userId, username: username, type: 'access' },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
}

// Generate long-lived refresh token (90 days)
function generateRefreshToken(userId) {
  const expiryDays = 90;
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + expiryDays);

  const token = jwt.sign(
    { id: userId, type: 'refresh' },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: `${expiryDays}d` }
  );

  return { token, expiryDate };
}

router.get('/check-username/:username', async (req, res) => {
  try {
    const rawUsername = req.params.username.trim();

    if (!rawUsername) {
      return res.status(400).json({ error: 'Username is required', available: false });
    }
    if (rawUsername.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters', available: false });
    }
    if (!/^[a-zA-Z0-9_.@]+$/.test(rawUsername)) {
      return res.status(400).json({ error: 'Username can only contain letters, numbers, underscores, @, and .', available: false });
    }

    const exists = await User.exists({
      username: { $regex: new RegExp(`^${rawUsername}$`, 'i') }
    });

    return res.json({ available: !exists });
  } catch (error) {
    console.error('Username check error:', error);
    return res.status(500).json({ error: 'Server error', available: false });
  }
});

router.get('/count-email/:email', async (req, res) => {
  try {
    const count = await User.countDocuments({ email: req.params.email });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: 'Internal error' });
  }
});

router.get('/count-mobile/:mobile', async (req, res) => {
  try {
    const count = await User.countDocuments({ mobile: req.params.mobile });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: 'Internal error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { email, mobile, confirmPassword, username, password, firstName, referralCode } = req.body;

    if (!firstName || !username || !password || !confirmPassword || !email) {
      return res.status(400).json({ error: 'First name, username, password, confirm password, and email are required' });
    }

    // Mobile is now optional, but if provided, validate it
    if (mobile && mobile.toString().trim()) {
      const existingMobile = await User.findOne({ mobile: mobile.toString().trim() });
      if (existingMobile) {
        return res.status(400).json({ error: 'Mobile number already registered' });
      }
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      return res.status(400).json({ error: 'Username is required' });
    }

    if (trimmedUsername.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }

    if (!/^[a-zA-Z0-9_.@]+$/.test(trimmedUsername)) {
      return res.status(400).json({ error: 'Username can only contain letters, numbers, underscores, @, and .' });
    }

    const usernameExists = await User.exists({
      username: { $regex: new RegExp(`^${trimmedUsername}$`, 'i') }
    });
    if (usernameExists) return res.status(400).json({ error: 'Username already taken' });

    let referralToken;
    do {
      referralToken = 'FUSE-' + Math.random().toString(36).substr(2, 9).toUpperCase();
    } while (await User.exists({ referralToken }));

    let referredBy = null;
    if (referralCode) {
      const referrer = await User.findOne({ referralToken: referralCode });
      if (referrer) {
        if (referrer.referrals.length >= 50) {
          return res.status(400).json({ error: 'Referrer has reached maximum referrals (50)' });
        }
        referredBy = referrer._id;
        referrer.credits += 10;
        referrer.referrals.push(null);
        referrer.creditHistory.push({
          type: 'earned',
          amount: 10,
          reason: 'Referral bonus: 10 credits'
        });
        await referrer.save();
      }
    }

    async function generateUniqueAnonId() {
      let anonId;
      let exists = true;
      while (exists) {
        anonId = 'Anon-' + Math.floor(1000 + Math.random() * 9000);
        exists = await User.exists({ anonId });
      }
      return anonId;
    }

    const anonId = await generateUniqueAnonId();

    const newUser = new User({
      firstName,
      username,
      password,
      email,
      mobile: mobile && mobile.toString().trim() ? mobile.toString().trim() : null,
      referralToken,
      referredBy,
      anonId,
      displayPicture: 'https://res.cloudinary.com/dhiw3k8to/image/upload/v1758988596/myUploads/fzf1dskuqnzrt92rt6px.jpg'
    });
    const savedUser = await newUser.save();

    // Generate and set tokens on signup (auto-login)
    const accessToken = generateAccessToken(savedUser._id, savedUser.username);
    const { token: refreshToken, expiryDate: refreshExpiryDate } = generateRefreshToken(savedUser._id);

    // Store refresh token in DB
    savedUser.longLivedToken = refreshToken;
    savedUser.tokenExpiryDate = refreshExpiryDate;
    savedUser.tokenLastRefreshedAt = new Date();
    savedUser.refreshTokens.push({
      tokenHash: hashToken(refreshToken),
      device: req.headers["user-agent"] || "web",
    });
    await savedUser.save();

    const cookieOptions = {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'None' : 'Lax',
      path: '/',
    };

    // Set both tokens as cookies (auto-login after signup)
    res.cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
    res.cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: 90 * 24 * 60 * 60 * 1000 });

    if (process.env.NODE_ENV !== "production") {
      console.log(`✅ Signup successful for user: ${savedUser.username}, tokens issued`);
    }

    if (referredBy) {
      const referrer = await User.findById(referredBy);
      referrer.referrals[referrer.referrals.length - 1] = savedUser._id; // Replace null with actual user ID
      await referrer.save();

      // Award 5 credits to new user
      savedUser.credits += 5;
      savedUser.creditHistory.push({
        type: 'earned',
        amount: 5,
        reason: 'Referral bonus: 5 credits'
      });
      await savedUser.save();
    }

    res.status(201).json({ message: 'Signup successful', user: savedUser.toObject() });

  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

module.exports = router;
