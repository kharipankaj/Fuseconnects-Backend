const express = require('express');
const User = require('../models/User');
const { hashToken } = require('../utils/crypto');

const router = express.Router();

// POST /api/logout - current device
router.post('/', async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      return res.status(204).send(); // No content
    }

    const deviceId = req.headers['x-device-id'] || req.headers['user-agent'] || 'unknown';
    const tokenHash = hashToken(refreshToken);

    const user = await User.findOne({ 
      'refreshTokens.tokenHash': tokenHash,
      'refreshTokens.device': deviceId 
    }).select('refreshTokens');

    if (user) {
      // Remove matching token
      user.refreshTokens = user.refreshTokens.filter(t => 
        !(t.tokenHash === tokenHash && t.device === deviceId)
      );
      await user.save();
    }

    // Clear cookie
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax'
    });

    res.json({ message: 'Logged out successfully' });

  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ message: 'Logout failed' });
  }
});

// POST /api/logout-all - all devices
router.post('/all', async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      return res.status(204).send();
    }

    // Get user from token (verify first)
    const decoded = require('jsonwebtoken').verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    const user = await User.findById(decoded.id);

    if (user) {
      user.refreshTokens = [];
      user.tokenLastRefreshedAt = null;
      await user.save();
    }

    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax'
    });

    res.json({ message: 'Logged out from all devices' });

  } catch (err) {
    console.error('Logout all error:', err);
    res.status(500).json({ message: 'Logout failed' });
  }
});

module.exports = router;

