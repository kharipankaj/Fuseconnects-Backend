const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');
const { creditWalletBalance, ensureWallet, getWalletSummary } = require('../services/walletService');

const REFERRAL_BONUS_AMOUNT = 2;

router.get('/info', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('referrals', 'username firstName lastName').select('referralToken credits referrals creditHistory');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const walletSummary = await getWalletSummary(req.user.id);

    res.json({
      referralToken: user.referralToken,
      referralsCount: user.referrals.length,
      referrals: user.referrals,
      referralRewardPerUser: REFERRAL_BONUS_AMOUNT,
      referralEarnings: Number((user.referrals.length * REFERRAL_BONUS_AMOUNT).toFixed(2)),
      wallet: walletSummary
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

    referrer.referrals.push(user._id);
    await referrer.save();

    user.usedReferralCodes.push(code);
    await user.save();

    await ensureWallet(referrer._id);
await creditWalletBalance({
      userId: referrer._id,
      type: 'bonus',
      amount: REFERRAL_BONUS_AMOUNT,
      balanceBucket: 'deposit_balance',
      referenceId: `referral:${user._id.toString()}`,
      metadata: {
        referredUserId: user._id.toString(),
        referralCode: code,
      },
      source: 'referral'
    });

    res.json({ message: `Referral code used successfully. Referrer earned Rs ${REFERRAL_BONUS_AMOUNT}.`, rewardAwarded: REFERRAL_BONUS_AMOUNT });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

module.exports = router;
