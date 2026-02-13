const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');

router.get('/info', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('referrals', 'username firstName lastName').select('referralToken credits referrals creditHistory');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      referralToken: user.referralToken,
      credits: user.credits,
      referralsCount: user.referrals.length,
      referrals: user.referrals,
      creditHistory: user.creditHistory
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

router.get('/validate/:code', async (req, res) => {
  try {
    const user = await User.findOne({ referralToken: req.params.code });
    if (!user) {
      return res.json({ valid: false });
    }
    res.json({ valid: true, referrer: { username: user.username, firstName: user.firstName, lastName: user.lastName } });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

router.post('/use-code', auth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Referral code is required' });
    }

    const referrer = await User.findOne({ referralToken: code });
    if (!referrer) {
      return res.status(400).json({ error: 'Invalid referral code' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (referrer._id.toString() === user._id.toString()) {
      return res.status(400).json({ error: 'Cannot use your own referral code' });
    }

    if (user.usedReferralCodes.includes(code)) {
      return res.status(400).json({ error: 'Referral code already used' });
    }

    if (referrer.referrals.length >= 50) {
      return res.status(400).json({ error: 'Referrer has reached maximum referrals (50)' });
    }

    referrer.credits += 10;
    referrer.referrals.push(user._id);
    referrer.creditHistory.push({
      type: 'earned',
      amount: 10,
      reason: 'Referral bonus: 10 credits'
    });
    await referrer.save();

    user.credits += 5;
    user.usedReferralCodes.push(code);
    user.creditHistory.push({
      type: 'earned',
      amount: 5,
      reason: 'Referral bonus: 5 credits'
    });
    await user.save();

    res.json({ message: 'Referral code used successfully! Referrer earned 10 credits, you earned 5 credits.', creditsAwarded: 5 });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

module.exports = router;
