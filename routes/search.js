const express = require("express");
const User = require("../models/User");

const router = express.Router();
router.get("/", async (req, res) => {
  try {
    const { q } = req.query;
    console.log("Search query:", q);

    if (!q) {
      return res.json([]);
    }

    const totalUsers = await User.countDocuments();
    console.log("Total users in database:", totalUsers);

    const user = await User.find({
      username: { $regex: '^' + q, $options: "i" },
    }).select("username firstName lastName profilePhoto displayPicture").limit(10);

    console.log("Search results:", user.length, "users found");
    if (user.length > 0) {
      console.log("Sample user:", user[0].username);
    }
    res.json(user);
  } catch (err) {
    console.error("❌ Search error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
