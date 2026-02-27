const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Otp = require('../models/Otp');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { sendOtpEmail } = require('../utils/mailer');

router.post('/search', async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }

        const users = await User.find({
            $or: [
                { username: { $regex: new RegExp(`^${query}$`, 'i') } },
                { email: { $regex: new RegExp(`^${query}$`, 'i') } },
                { mobile: query }
            ]
        }).select('username email mobile firstName lastName displayPicture');

        if (users.length === 0) {
            return res.status(404).json({ error: 'No accounts found' });
        }

        res.json({ users });
    } catch (err) {
        console.error('Forgot password search error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});
router.post('/send-otp', async (req, res) => {
    try {
        const { username } = req.body;
        if (!username) {
            return res.status(400).json({ error: 'Username is required' });
        }

        const user = await User.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const email = user.email;
        
        if (!email) {
            console.error('❌ User has no email on file:', username);
            return res.status(400).json({ error: 'User email not found' });
        }

        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentSends = await Otp.countDocuments({
            email,
            createdAt: { $gte: oneHourAgo }
        });

        if (recentSends >= parseInt(process.env.MAX_SENDS_PER_HOUR || 10)) {
            return res.status(429).json({ error: 'Too many OTP requests. Please wait an hour.' });
        }
        
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + (parseInt(process.env.OTP_TTL_SECONDS || 300) * 1000));

        const newOtp = new Otp({
            userId: user._id,
            email,
            otp,
            expiresAt
        });
        await newOtp.save();

        console.log(`📧 Attempting to send OTP to ${email} for user ${username}...`);
        const emailResult = await sendOtpEmail(email, otp);
        
        if (!emailResult.success) {
            console.error('❌ Failed to send OTP:', emailResult.error);
            await newOtp.deleteOne();
            return res.status(500).json({ error: 'Failed to send OTP email. Please check your email address or try again later.' });
        }

        console.log(`✅ OTP sent successfully to ${email}`);
        res.json({ message: 'OTP sent successfully to your email' });
    } catch (err) {
        console.error('❌ Send OTP error:', err);
        res.status(500).json({ error: 'Server error: ' + err.message });
    }
});

router.post('/verify-otp', async (req, res) => {
    try {
        const { username, otp } = req.body;
        if (!username || !otp) {
            return res.status(400).json({ error: 'Username and OTP are required' });
        }

        const user = await User.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const currentOtp = await Otp.findOne({
            userId: user._id,
            expiresAt: { $gt: new Date() },
            resetToken: { $exists: false } 
        }).sort({ createdAt: -1 });

        if (!currentOtp) {
            return res.status(400).json({ error: 'No valid OTP found. Please request a new one.' });
        }

        if (currentOtp.attempts >= parseInt(process.env.MAX_VERIFY_ATTEMPTS || 5)) {
            await currentOtp.deleteOne();
            return res.status(400).json({ error: 'Too many attempts. Please request a new OTP.' });
        }

        const isValid = await currentOtp.compareOtp(otp);
        if (!isValid) {
            currentOtp.attempts += 1;
            await currentOtp.save();
            return res.status(400).json({ error: 'Invalid OTP' });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        currentOtp.resetToken = resetToken;
        await currentOtp.save();

        res.json({ message: 'OTP verified successfully', resetToken });
    } catch (err) {
        console.error('Verify OTP error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/reset-password', async (req, res) => {
    try {
        const { resetToken, newPassword } = req.body;
        if (!resetToken || !newPassword) {
            return res.status(400).json({ error: 'Reset token and new password are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const otpDoc = await Otp.findOne({
            resetToken,
            expiresAt: { $gt: new Date() }
        });

        if (!otpDoc) {
            return res.status(400).json({ error: 'Invalid or expired reset token' });
        }

        const user = await User.findById(otpDoc.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.password = newPassword;
        await user.save();

        await otpDoc.deleteOne();

        res.json({ message: 'Password reset successful' });
    } catch (err) {
        console.error('Reset password error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
