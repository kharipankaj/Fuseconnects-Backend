const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

const router = express.Router();

/**
 * 🧾 SIGNUP (simple version)
 */
router.post("/signup", async (req, res) => {
  try {
    const { firstName, username, email, password } = req.body;

    // 🔥 basic validation
    if (!firstName || !username || !email || !password) {
      return res.status(400).json({
        message: "All fields required (firstName, username, email, password)",
      });
    }

    // 🔐 password hash
    const hashedPassword = await bcrypt.hash(password, 10);

    // 👤 user create - match User.js schema
    const user = new User({
      firstName,
      username: username.toLowerCase().trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      balance: 1000,  // starter balance for betting
    });

    await user.save();

    return res.json({
      success: true,
      message: "User saved in DB",
    });

  } catch (err) {
    console.error("Signup Error:", err);

    return res.status(500).json({
      message: "Server error",
    });
  }
});

module.exports = router;