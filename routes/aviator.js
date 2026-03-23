const express = require("express");
const User = require("../models/User");
const { Bet: AviatorBet } = require("../models/Aviator-bet");
const auth = require("../middleware/auth");

const router = express.Router();


router.get("/", auth, async (req, res) => {
    try {
        const { userId } = req.user;

        const user = await User.findById(userId).select("-password -refreshTokens");

        if (!user) {
            return res.status(404).json({
                message: "User not found",
            });
        }

        return res.json({
            success: true,
            data: {
                _id: user._id,
                username: user.username,
                walletBalance: user.walletBalance || user.balance || 0,
                role: user.role || "user"
            }
        });
    } catch (err) {
        return res.status(500).json({
            message: "Server error",
        });
    }
});

/**
 * 🎰 Profile endpoint compatibility (redirect to /profile)
 */
router.get("/mybets", async (req, res) => {
    try {
        const { userId } = req.user;
        console.log("🧾 mybets request for userId:", userId);

        const bets = await AviatorBet.find({ playerId: userId })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();

        console.log(`✅ mybets: Found ${bets.length} bets for ${userId.slice(-4)}`);

        return res.json({
            success: true,
            bets,
            count: bets.length
        });

    } catch (err) {
        console.error("❌ mybets error:", err);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch bets"
        });
    }
});

module.exports = router;
