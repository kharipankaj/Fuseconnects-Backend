const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { hashToken } = require('../utils/crypto');
const User = require('../models/User');

router.post('/', async (req, res) => {
    try {
        const { username, token } = req.body;
        if (!token || !username) return res.status(400).json({ error: 'Username and token required' });

        const tokenHash = hashToken(token);

        const user = await User.findOne({
            username: { $regex: new RegExp(`^${username}$`, 'i') },
            verificationTokenHash: tokenHash,
            verificationExpires: { $gt: new Date() }
        });

        if (!user) return res.status(400).json({ error: 'Invalid or expired token' });

        user.isVerified = true;
        user.verificationTokenHash = null;
        user.verificationExpires = null;
        await user.save();

        return res.json({ message: 'Email verified successfully' });
    } catch (err) {
        console.error('Verify email error:', err);
        return res.status(500).json({ error: 'Server error' });
    }
});

router.post('/resend', async (req, res) => {
    try {
        const { username } = req.body;
        if (!username) return res.status(400).json({ error: 'Username required' });

        const user = await User.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.isVerified) return res.status(400).json({ error: 'User already verified' });

        const verificationToken = crypto.randomBytes(32).toString('hex');
        user.verificationTokenHash = hashToken(verificationToken);
        user.verificationExpires = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
        await user.save();

        const { sendVerificationEmail } = require('../utils/mailer');
        const emailResult = await sendVerificationEmail(user.email, verificationToken, user.username);
        if (!emailResult.success) {
            console.warn('Resend verification failed:', emailResult.error);
            return res.status(500).json({ error: 'Failed to send verification email' });
        }

        return res.json({ message: 'Verification email resent' });
    } catch (err) {
        console.error('Resend verification error:', err);
        return res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
