const express = require("express");
const router = express.Router();
const User = require("../models/User");
const auth = require("../middleware/auth");

router.get("/", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ message: "Verification done", user });
  } catch (err) {
    console.error("❌ Error in /home:", err.message);
    res.status(500).json({ message: "Server error: " + err.message });
  }
});

module.exports = router;
