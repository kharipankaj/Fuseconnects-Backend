const express = require("express");
const router = express.Router();
const User = require("../models/User");
const auth = require("../middleware/auth");

router.get("/", auth, async (req, res) => {
  try {
    const { role } = req.user;

    const allowedRoles = ["admin", "moderator"];

    if (!allowedRoles.includes(role)) {
      return res.status(403).send("Access denied");
    }

    

    return res.status(200).json({
      message: "Welcome to FuseConnects Moderation Panel",
      stats: {
       
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

router.use((req, res) => {
  res.status(404).send("404 Page Not Found");
});

module.exports = router;
