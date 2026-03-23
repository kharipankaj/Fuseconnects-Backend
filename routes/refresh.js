const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { hashToken } = require('../utils/crypto');
const cookieParser = require('cookie-parser'); // Ensure used in server

const router = express.Router();
const isProd = process.env.NODE_ENV === 'production';

// Generate new tokens (reuse from login logic)
function generateAccessToken(user) {
  return jwt.sign(
    {
      id: user._id,
      username: user.username,
      role: user.role,
      type: 'access'
    },
    process.env.JWT_SECRET,
{ expiresIn: '7d' }
  );
}

function generateRefreshToken(userId) {
  return jwt.sign(
    {
      id: userId,
      type: 'refresh'
    },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: '90d' }
  );
}

// POST /api/refresh
router.post('/', async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ message: 'No refresh token' });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    const user = await User.findById(decoded.id).select('+refreshTokens');
    if (!user) {
      return res.status(401).json({ message: 'Invalid refresh token' });
    }

    const deviceId = req.headers['x-device-id'] || req.headers['user-agent'] || 'unknown';
    const tokenHash = hashToken(refreshToken);
    const tokenIndex = user.refreshTokens.findIndex(t => t.tokenHash === tokenHash && t.device === deviceId);

    if (tokenIndex === -1) {
      return res.status(401).json({ message: 'Invalid device or token' });
    }

    // Rotate tokens
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user._id);

    // Remove old token
    user.refreshTokens.splice(tokenIndex, 1);
    // Add new
    user.refreshTokens.push({
      tokenHash: hashToken(newRefreshToken),
      device: deviceId,
      createdAt: new Date()
    });
    user.tokenLastRefreshedAt = new Date();
    await user.save();

    // Set new cookie
    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 90 * 24 * 60 * 60 * 1000
    });

    res.json({
      message: 'Token refreshed',
      accessToken: newAccessToken
    });

  } catch (err) {
    console.error('Refresh error:', err);
    res.status(401).json({ message: 'Token refresh failed' });
  }
});

module.exports = router;

