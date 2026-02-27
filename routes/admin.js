const express = require("express");
const router = express.Router();
const User = require("../models/User");
const ModerationReport = require("../models/ModerationReport");
const CommunityRoom = require("../models/CommunityRoom");
const GeneralRoom = require("../models/GeneralRoom");
const auth = require("../middleware/auth");

router.get("/", auth, async (req, res) => {
  try {
    const { id, role } = req.user;

    if (role !== "admin") {
      return res.status(403).send("Access denied");
    }

    // 📊 Admin dashboard data
    const bans = await User.countDocuments({ banned: true });
    const staff = await User.countDocuments({
      role: { $in: ["helper", "moderator", "admin"] },
    });
    const reportsOpen = await ModerationReport.countDocuments({ status: 'open' });

    // 📋 Fetch recent moderation reports
    const reports = await ModerationReport.find()
      .populate("reporter", "username")
      .populate("reportedUser", "username")
      .sort({ createdAt: -1 })
      .limit(20);

    // 🏘️ Fetch all community rooms
    let communityRooms = [];
    try {
      communityRooms = await CommunityRoom.find()
        .populate("createdBy", "username firstName")
        .sort({ createdAt: -1 })
        .lean();
      console.log(`✅ Fetched ${communityRooms.length} community rooms`);
    } catch (err) {
      console.error("❌ Error fetching community rooms:", err.message);
    }

    // 🌍 Fetch all general rooms
    let generalRooms = [];
    try {
      generalRooms = await GeneralRoom.find()
        .sort({ createdAt: -1 })
        .lean();
      console.log(`✅ Fetched ${generalRooms.length} general rooms`);
    } catch (err) {
      console.error("❌ Error fetching general rooms:", err.message);
    }

    const servers = [
      ...communityRooms.map(room => ({
        ...room,
        roomType: 'community',
        roomName: room.roomName,
        createdBy: room.createdBy || { username: 'System', firstName: 'System' }
      })),
      ...generalRooms.map(room => ({
        ...room,
        roomType: 'general',
        roomName: room.name || `General Room ${room._id}`,
        roomId: room.roomId || room._id,
        city: room.city || 'Unknown',
        createdBy: { username: 'System', firstName: 'System' }
      }))
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    console.log(`📦 Total servers combined: ${servers.length}`, { communityCount: communityRooms.length, generalCount: generalRooms.length });

    return res.status(200).json({
      ok: true,
      message: "Welcome to FuseConnects Admin Panel",
      stats: {
        bans,
        staff,
        reportsOpen,
      },
      reports: reports || [],
      servers: servers || [],
    });

  } catch (err) {
    console.error("Failed to load admin data:", err.message);
    return res.status(500).json({
      ok: false,
      message: "Failed to load admin data",
    });
  }
});

router.use((req, res) => {
  res.status(404).send("404 Page Not Found");
});

module.exports = router;
