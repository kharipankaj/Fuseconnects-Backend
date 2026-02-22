const express = require("express");
const router = express.Router();
const User = require("../models/User");
const UserWarning = require("../models/UserWarning");
const UserBlock = require("../models/UserBlock");
const Message = require("../models/message");
const auth = require("../middleware/auth");
const { blockUser, unblockUser, getActiveBlocks, getUserBlockHistory } = require("../utils/blockingHelper");

router.get("/", auth, async (req, res) => {
  try {
    const { role } = req.user;

    console.log(`🔍 Moderation access attempt:`);
    console.log(`   User: ${req.user.username}`);
    console.log(`   Role: ${role}`);

    const allowedRoles = ["admin", "moderator"];

    if (!allowedRoles.includes(role)) {
      console.log(`   ❌ Access denied: "${role}" is not in allowed roles: ${allowedRoles.join(', ')}`);
      return res.status(403).json({
        ok: false,
        message: "Access denied",
        required_role: allowedRoles,
        current_role: role
      });
    }

    console.log(`   ✅ Access granted`);

    // Get moderation stats
    const totalWarnings = await UserWarning.countDocuments();
    const activeWarnings = await UserWarning.countDocuments({ status: 'active' });
    const byCategory = await UserWarning.aggregate([
      { $group: { _id: "$violationType", count: { $sum: 1 } } }
    ]);

    return res.status(200).json({
      message: "Welcome to FuseConnects Moderation Panel",
      stats: {
        totalWarnings,
        activeWarnings,
        byCategory: Object.fromEntries(byCategory.map(b => [b._id, b.count]))
      },
    });

  } catch (err) {
    console.error("Failed to load moderation data:", err.message);
    return res.status(500).json({
      ok: false,
      message: "Failed to load moderation data",
    });
  }
});

/**
 * GET /moderation/warnings
 * Get all user warnings (paginated)
 */
router.get("/warnings", auth, async (req, res) => {
  try {
    const { role } = req.user;
    const allowedRoles = ["admin", "moderator"];
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ ok: false, message: "Access denied" });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status || "active";

    const warnings = await UserWarning.find({ status })
      .populate("userId", "username email")
      .populate("messageId", "text sentAt")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const total = await UserWarning.countDocuments({ status });

    res.status(200).json({
      ok: true,
      warnings,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error("Error fetching warnings:", err);
    res.status(500).json({ ok: false, message: "Failed to fetch warnings" });
  }
});

/**
 * GET /moderation/warnings/:userId
 * Get warnings for a specific user
 */
router.get("/warnings/:userId", auth, async (req, res) => {
  try {
    const { role } = req.user;
    const allowedRoles = ["admin", "moderator"];
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ ok: false, message: "Access denied" });
    }

    const { userId } = req.params;
    const warnings = await UserWarning.find({ 
      $or: [{ userId }, { anonId: userId }]
    })
      .sort({ createdAt: -1 })
      .lean();

    const activeCount = warnings.filter(w => w.status === 'active').length;

    res.status(200).json({
      ok: true,
      warnings,
      activeCount,
      totalCount: warnings.length
    });
  } catch (err) {
    console.error("Error fetching user warnings:", err);
    res.status(500).json({ ok: false, message: "Failed to fetch user warnings" });
  }
});

/**
 * PATCH /moderation/warnings/:warningId
 * Update warning status
 */
router.patch("/warnings/:warningId", auth, async (req, res) => {
  try {
    const { role } = req.user;
    const allowedRoles = ["admin", "moderator"];
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ ok: false, message: "Access denied" });
    }

    const { warningId } = req.params;
    const { status } = req.body;

    if (!['active', 'acknowledged', 'resolved'].includes(status)) {
      return res.status(400).json({ ok: false, message: "Invalid status" });
    }

    const warning = await UserWarning.findByIdAndUpdate(
      warningId,
      { 
        status,
        acknowledgedAt: status === 'acknowledged' ? Date.now() : undefined
      },
      { new: true }
    );

    if (!warning) {
      return res.status(404).json({ ok: false, message: "Warning not found" });
    }

    res.status(200).json({
      ok: true,
      message: "Warning updated",
      warning
    });
  } catch (err) {
    console.error("Error updating warning:", err);
    res.status(500).json({ ok: false, message: "Failed to update warning" });
  }
});

/**
 * GET /moderation/blocked-words
 * Get common violation statistics
 */
router.get("/blocked-words", auth, async (req, res) => {
  try {
    const { role } = req.user;
    const allowedRoles = ["admin", "moderator"];
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ ok: false, message: "Access denied" });
    }

    const stats = await UserWarning.aggregate([
      {
        $group: {
          _id: "$violationType",
          count: { $sum: 1 },
          rooms: { $push: "$roomId" }
        }
      },
      { $sort: { count: -1 } }
    ]);

    const timeStats = await UserWarning.aggregate([
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: -1 } },
      { $limit: 30 }
    ]);

    res.status(200).json({
      ok: true,
      violationsByType: stats,
      violationsByDay: timeStats
    });
  } catch (err) {
    console.error("Error fetching violation stats:", err);
    res.status(500).json({ ok: false, message: "Failed to fetch statistics" });
  }
});

/**
 * POST /moderation/block-user
 * Block a user for specified duration
 * Admin/Moderator only
 */
router.post("/block-user", auth, async (req, res) => {
  try {
    const { role } = req.user;
    const allowedRoles = ["admin", "moderator"];

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ ok: false, message: "Access denied" });
    }

    const { userId, anonId, durationMinutes, reason = 'other' } = req.body;

    if (!userId && !anonId) {
      return res.status(400).json({
        ok: false,
        message: "Either userId or anonId is required"
      });
    }

    if (!durationMinutes || durationMinutes < 1) {
      return res.status(400).json({
        ok: false,
        message: "Duration must be at least 1 minute"
      });
    }

    const block = await blockUser(
      userId,
      anonId,
      req.user.id,
      durationMinutes,
      reason,
      req.user.anonId
    );

    res.status(201).json({
      ok: true,
      message: `User blocked for ${durationMinutes} minutes`,
      block
    });
  } catch (err) {
    console.error("Error blocking user:", err);
    res.status(500).json({ ok: false, message: "Failed to block user" });
  }
});

/**
 * POST /moderation/unblock-user
 * Unblock a user immediately
 * Admin/Moderator only
 */
router.post("/unblock-user", auth, async (req, res) => {
  try {
    const { role } = req.user;
    const allowedRoles = ["admin", "moderator"];

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ ok: false, message: "Access denied" });
    }

    const { userId, anonId } = req.body;

    if (!userId && !anonId) {
      return res.status(400).json({
        ok: false,
        message: "Either userId or anonId is required"
      });
    }

    const success = await unblockUser(userId, anonId);

    if (!success) {
      return res.status(404).json({
        ok: false,
        message: "No active block found for this user"
      });
    }

    res.status(200).json({
      ok: true,
      message: "User unblocked successfully"
    });
  } catch (err) {
    console.error("Error unblocking user:", err);
    res.status(500).json({ ok: false, message: "Failed to unblock user" });
  }
});

/**
 * GET /moderation/active-blocks
 * Get all active user blocks
 * Admin/Moderator only
 */
router.get("/active-blocks", auth, async (req, res) => {
  try {
    const { role } = req.user;
    const allowedRoles = ["admin", "moderator"];

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ ok: false, message: "Access denied" });
    }

    const blocks = await getActiveBlocks();

    res.status(200).json({
      ok: true,
      count: blocks.length,
      blocks
    });
  } catch (err) {
    console.error("Error fetching active blocks:", err);
    res.status(500).json({ ok: false, message: "Failed to fetch blocks" });
  }
});

/**
 * GET /moderation/block-history/:userId
 * Get block history for a specific user
 * Admin/Moderator only
 */
router.get("/block-history/:userId", auth, async (req, res) => {
  try {
    const { role } = req.user;
    const allowedRoles = ["admin", "moderator"];

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ ok: false, message: "Access denied" });
    }

    const { userId } = req.params;

    const history = await getUserBlockHistory(userId);

    res.status(200).json({
      ok: true,
      count: history.length,
      history
    });
  } catch (err) {
    console.error("Error fetching block history:", err);
    res.status(500).json({ ok: false, message: "Failed to fetch block history" });
  }
});

/**
 * POST /moderation/assign-role
 * Assign moderator/admin role to a user
 * Admin only
 */
router.post("/assign-role", auth, async (req, res) => {
  try {
    const { role: currentRole } = req.user;

    // Only admins can assign roles
    if (currentRole !== "admin") {
      return res.status(403).json({ ok: false, message: "Only admins can assign roles" });
    }

    const { userId, role } = req.body;

    if (!userId || !role) {
      return res.status(400).json({
        ok: false,
        message: "userId and role are required"
      });
    }

    const validRoles = ['user', 'helper', 'moderator', 'admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        ok: false,
        message: `Role must be one of: ${validRoles.join(', ')}`
      });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { role },
      { new: true }
    ).select('username role anonId');

    if (!user) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    res.status(200).json({
      ok: true,
      message: `User role updated to ${role}`,
      user
    });
  } catch (err) {
    console.error("Error assigning role:", err);
    res.status(500).json({ ok: false, message: "Failed to assign role" });
  }
});

router.use((req, res) => {
  res.status(404).send("404 Page Not Found");
});

module.exports = router;
