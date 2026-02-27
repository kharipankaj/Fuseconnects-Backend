const express = require("express");
const router = express.Router();

const User = require("../models/User.js");

router.get("/staff/check", async (req, res) => {
  try {
    console.log("🟡 /staff/check HIT");
    console.log("➡️ Query params:", req.query);

    const { email, anonId, name } = req.query;

    const query = {
      role: { $ne: "user" }, 
    };

    if (email) query.email = email;
    if (anonId) query.anonId = anonId;
    if (name) query.name = name;

    console.log("🧠 Mongo Query:", query);

    const exists = await User.findOne(query).lean();

    console.log(
      exists
        ? "❌ Staff already exists"
        : "✅ Staff available"
    );

    return res.json({
      available: !exists,
    });
  } catch (error) {
    console.error("🔥 Error in /staff/check:", error);
    res.status(500).json({ message: "Server error" });
  }
});


router.post("/staff/suggest", async (req, res) => {
  try {
    console.log("🟡 /staff/suggest HIT");
    console.log("➡️ Body received:", req.body);

    const { name } = req.body;

    if (!name) {
      console.log("❌ Name missing");
      return res.status(400).json({ message: "Name required" });
    }

    const base = name.toLowerCase().replace(/\s+/g, "");
    let email = `${base}@fuseconnects.com`;
    let anonId = `Anon-${Math.floor(1000 + Math.random() * 9000)}`;

    console.log("🔁 Initial email:", email);
    console.log("🔁 Initial anonId:", anonId);

    while (
      await User.findOne({
        email,
        role: { $ne: "user" },
      })
    ) {
      email = `${base}${Math.floor(Math.random() * 100)}@fuseconnects.com`;
      console.log("⚠️ Email exists, retry:", email);
    }

    while (
      await User.findOne({
        anonId,
        role: { $ne: "user" },
      })
    ) {
      anonId = `Anon-${Math.floor(1000 + Math.random() * 9000)}`;
      console.log("⚠️ AnonId exists, retry:", anonId);
    }

    console.log("✅ Final suggestion:", { email, anonId });

    res.json({ email, anonId });
  } catch (error) {
    console.error("🔥 Error in /staff/suggest:", error);
    res.status(500).json({ message: "Server error" });
  }
});


router.post("/add", async (req, res) => {
  try {
    const { anonId, role } = req.body;

    const user = await User.findOne({ anonId });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.role === 'user' && role.toLowerCase() === 'moderator') {
      return res.status(400).json({ message: "Cannot promote user role to moderator" });
    }

    const updatedUser = await User.findOneAndUpdate(
      { anonId },
      { $set: { role: role.toLowerCase() } },
      { new: true }
    );

    console.log("✅ Role updated in DB:", updatedUser.anonId, updatedUser.role);

    res.json({
      message: "Role updated successfully",
      user: {
        anonId: updatedUser.anonId,
        role: updatedUser.role,
      },
    });
  } catch (error) {
    console.error("🔥 Error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/list", async (req, res) => {
  try {
    console.log("🟡 GET /managestaff/list HIT");

    const staff = await User.find(
      {
        role: { $in: ["admin", "moderator", "support"] }, // ✅ only staff
      },
      {
        name: 1,
        anonId: 1,
        email: 1,
        role: 1,
        lastActive: 1,
      }
    ).lean();

    console.log(`✅ Staff count: ${staff.length}`);

    res.json({ staff });
  } catch (error) {
    console.error("🔥 Error fetching staff:", error);
    res.status(500).json({ message: "Server error" });
  }
});



module.exports = router;
