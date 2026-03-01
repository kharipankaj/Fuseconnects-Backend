const express = require("express");
const User = require("../models/User");
const auth = require("../middleware/auth.js");

const router = express.Router();

// Public usernames list for sitemap generation (no auth)
router.get("/public/list", async (req, res) => {
  try {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(rawLimit, 5000))
      : 500;

    const users = await User.find({
      username: { $exists: true, $ne: "" },
      isPrivate: { $ne: true },
    })
      .select("username createdAt")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json(
      users.map((u) => ({
        username: u.username,
        lastmod: u.createdAt || null,
      }))
    );
  } catch (err) {
    console.error("Public user list error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/:username", auth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    const currentUser = await User.findById(req.user.id);
    const isFollowing = currentUser.following.includes(user._id);
    const followsBack = user.following.includes(currentUser._id);

    res.json({
      username: user.username,
      fullName: `${user.firstName} ${user.lastName}`,
      bio: user.bio,
      city: user.city,
      displayPicture: user.displayPicture,
      followerCount: user.followers.length,
      followingCount: user.following.length,
      postCount: user.postCount,
      isFollowing: isFollowing,
      isOwnProfile: req.user.id === user._id.toString(),
      followsBack: followsBack,
      isPrivate: user.isPrivate,
      hasPendingRequest: user.followRequests.some(req => req.requester.toString() === currentUser._id.toString() && req.status === 'pending'),
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// Public profile data for SEO/crawlers (no auth)
router.get("/public/:username", async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({
      username: user.username,
      fullName: `${user.firstName} ${user.lastName}`,
      bio: user.bio,
      city: user.city,
      displayPicture: user.displayPicture,
      postCount: user.postCount,
      followerCount: user.followers.length,
    });
  } catch (err) {
    console.error("❌ Public profile fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
