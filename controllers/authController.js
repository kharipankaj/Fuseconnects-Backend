const bcrypt = require('bcryptjs');
const Joi = require('joi');
const User = require('../models/User');
const { hashToken } = require('../utils/crypto');
const jwt = require('jsonwebtoken');

const isProd = process.env.NODE_ENV === 'production';

// ENV validation
if (!process.env.JWT_SECRET || !process.env.REFRESH_TOKEN_SECRET) {
  console.error('❌ JWT secrets missing - check .env');
}

// Token generators
const generateAccessToken = (user) => {
  return jwt.sign(
    { 
      userId: user._id, 
      username: user.username, 
      role: user.role 
    },
    process.env.JWT_SECRET || 'fallback_secret_dev_only',
{ expiresIn: '7d' }
  );
};

const generateRefreshToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.REFRESH_TOKEN_SECRET || 'fallback_refresh_dev_only',
    { expiresIn: '90d' }
  );
};

// Mobile normalization (India)
const normalizeMobile = (input) => {
  const digits = String(input || '').replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return null;
};

// Validate signup input
const signupSchema = Joi.object({
  username: Joi.string().min(3).max(20).regex(/^[a-zA-Z0-9_@.]+$/).required().messages({
    'string.pattern.base': 'Username can only contain letters, numbers, _, @, .'
  }),
  email: Joi.string().email().allow(''),
  mobile: Joi.string().allow(''),
  password: Joi.string().min(6).required(),
  firstName: Joi.string().max(50).required(),
  lastName: Joi.string().max(50).allow('')
}).custom((value, helpers) => {
  if (!value.email && !value.mobile) {
    return helpers.error('any.required', { message: 'Email or mobile required' });
  }
  return value;
});

// @desc    Register user  
// @route   POST /api/auth/signup
exports.signup = async (req, res) => {
  try {
    const { error } = signupSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    const { username, email, mobile: rawMobile, password, firstName, lastName } = req.body;
    const normalizedMobile = normalizeMobile(rawMobile);

    // Check existing
    const existingQuery = { username: username.toLowerCase().trim() };
    if (email) existingQuery.$or = existingQuery.$or || []; existingQuery.$or.push({ email: email.toLowerCase().trim() });
    if (normalizedMobile) existingQuery.$or = existingQuery.$or || []; existingQuery.$or.push({ mobile: normalizedMobile });

    const existingUser = await User.findOne(existingQuery);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'Username, email, or mobile already exists'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const user = await User.create({
      username: username.toLowerCase().trim(),
      email: email ? email.toLowerCase().trim() : undefined,
      mobile: normalizedMobile,
      password: hashedPassword,
      firstName: firstName.trim(),
      lastName: lastName ? lastName.trim() : ''
    });

    const userObj = user.toObject();
    delete userObj.password;

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      data: userObj
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during signup'
    });
  }
};

// Validate login input
const loginSchema = Joi.object({
  identifier: Joi.string().required(),
  password: Joi.string().required()
});

// @desc    Login user
// @route   POST /api/auth/login
exports.login = async (req, res) => {
  try {
    const { error } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed'
      });
    }

    const { identifier, password } = req.body;
    const normalizedMobile = normalizeMobile(identifier);

    // Find user by identifier
    const userQuery = {
      $or: [
        { username: { $regex: new RegExp(`^${identifier.trim()}$`, 'i') } },
        ...(identifier.includes('@') ? [{ email: identifier.toLowerCase().trim() }] : []),
        ...(normalizedMobile ? [{ mobile: normalizedMobile }] : [])
      ]
    };

    const user = await User.findOne(userQuery).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user._id);

    // Handle refresh token rotation per device
    const deviceId = req.headers['x-device-id'] || req.headers['user-agent'] || 'unknown';
    const tokenHash = hashToken(refreshToken);

    // Clean expired tokens (createdAt > 90 days)
    user.refreshTokens = user.refreshTokens.filter(t => 
      new Date(t.createdAt) > new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    );

    // Replace if same device
    const existingIndex = user.refreshTokens.findIndex(t => t.device === deviceId);
    if (existingIndex !== -1) {
      user.refreshTokens[existingIndex] = { tokenHash, device: deviceId, createdAt: new Date() };
    } else {
      user.refreshTokens.push({ tokenHash, device: deviceId, createdAt: new Date() });
    }

    user.tokenLastRefreshedAt = new Date();
    await user.save();

    // Secure cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 90 * 24 * 60 * 60 * 1000
    });

    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.refreshTokens;

    res.json({
      success: true,
      message: 'Login successful',
      accessToken,
      user: userObj
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
};

// @desc    Refresh access token
// @route   POST /api/auth/refresh
exports.refreshToken = async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'No refresh token'
      });
    }

    const deviceId = req.headers['x-device-id'] || req.headers['user-agent'] || 'unknown';
    const tokenHash = hashToken(refreshToken);

    const user = await User.findOne({
      'refreshTokens.tokenHash': tokenHash,
      'refreshTokens.device': deviceId
    }).select('+refreshTokens');

    if (!user) {
      res.clearCookie('refreshToken');
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    // Generate new tokens
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user._id);
    const newTokenHash = hashToken(newRefreshToken);

    // Rotate token (replace)
    const tokenIndex = user.refreshTokens.findIndex(t => t.tokenHash === tokenHash && t.device === deviceId);
    if (tokenIndex !== -1) {
      user.refreshTokens[tokenIndex] = { tokenHash: newTokenHash, device: deviceId, createdAt: new Date() };
    }

    user.tokenLastRefreshedAt = new Date();
    await user.save();

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 90 * 24 * 60 * 60 * 1000
    });

    res.json({
      success: true,
      message: 'Token refreshed',
      accessToken: newAccessToken
    });

  } catch (error) {
    console.error('Refresh error:', error);
    res.status(401).json({
      success: false,
      message: 'Token refresh failed'
    });
  }
};

// @desc    Logout current device
// @route   POST /api/auth/logout
exports.logout = async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (refreshToken) {
      const deviceId = req.headers['x-device-id'] || req.headers['user-agent'] || 'unknown';
      const tokenHash = hashToken(refreshToken);

      await User.updateOne({
        'refreshTokens.tokenHash': tokenHash,
        'refreshTokens.device': deviceId
      }, {
        $pull: { refreshTokens: { tokenHash, device: deviceId } }
      });
    }

    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax'
    });

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
};

// @desc    Logout all devices
// @route   POST /api/auth/logout-all
exports.logoutAll = async (req, res) => {
  try {
    if (req.user?.userId) {
      await User.updateOne(
        { _id: req.user.userId },
        { refreshTokens: [], tokenLastRefreshedAt: null }
      );
    }

    res.clearCookie('refreshToken');
    res.json({
      success: true,
      message: 'Logged out from all devices'
    });

  } catch (error) {
    console.error('Logout all error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
};

// @desc    Account suggestions
// @route   POST /api/auth/accounts
exports.accounts = async (req, res) => {
  try {
    const { identifier } = req.body;
    if (!identifier) {
      return res.status(400).json({ message: 'Identifier required' });
    }

    const normalizedMobile = normalizeMobile(identifier);
    const queries = [];
    
    if (identifier.includes('@')) {
      queries.push({ email: identifier.toLowerCase().trim() });
    }
    if (normalizedMobile) {
      queries.push({ mobile: normalizedMobile });
    }

    const users = await User.find({ $or: queries })
      .select('username firstName lastName email mobile')
      .limit(5);

    res.json({
      success: true,
      accounts: users.map(u => ({
        username: u.username,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        mobile: u.mobile
      }))
    });

  } catch (error) {
    console.error('Accounts error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get profile (full data for frontend - protected route)
exports.getProfile = async (req, res) => {
  try {
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const user = await User.findById(req.user.userId).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const stats = {
      totalGames: user.gamesPlayed || 0,
      wins: user.totalWins || 0,
      winRate: user.gamesPlayed ? ((user.totalWins / user.gamesPlayed) * 100).toFixed(1) : 0,
      referralEarnings: 0
    };

    res.json({
      success: true,
      data: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName || '',
        name: `${user.firstName} ${user.lastName || ''}`.trim(),
        username: user.username,
        email: user.email,
        mobile: user.mobile,
        role: user.role,
        isVerified: user.isVerified,
        walletBalance: user.walletBalance || user.balance || 0,
        referralCode: user.username.toUpperCase(),
        stats,
        recentTransactions: []
      }
    });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};


