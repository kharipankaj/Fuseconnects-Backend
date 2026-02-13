const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.js");

const User = require("../models/User.js");
const CommunityRoom = require("../models/CommunityRoom.js");

router.post("/", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { roomName } = req.body;

    if (!roomName) {
      return res.status(400).json({
        joined: false,
        message: "Room name is required",
      });
    }

    // 1️⃣ Normalize room name
    const normalizedRoomName = roomName.toLowerCase().trim();

    // 2️⃣ Get user + anonId
    const user = await User.findById(userId).select("anonId city").lean();
    if (!user || !user.city || !user.anonId) {
      return res.status(404).json({
        joined: false,
        message: "User data incomplete",
      });
    }

    // 3️⃣ Find community room by roomName + city
    const room = await CommunityRoom.findOne({
      roomName: normalizedRoomName,
      city: user.city.toLowerCase(),
      isActive: true,
    });

    if (!room) {
      return res.status(404).json({
        joined: false,
        message: "Community room not found",
      });
    }

    // 4️⃣ If already joined → return success
    if (room.anonIds.includes(user.anonId)) {
      return res.json({
        joined: true,
        alreadyJoined: true,
        anonId: user.anonId,
      });
    }

    // 5️⃣ Add anonId to room
    room.anonIds.push(user.anonId);
    room.totalMembers = (room.totalMembers || 0) + 1;

    await room.save();

    // 6️⃣ Success response
    return res.json({
      joined: true,
      anonId: user.anonId,
    });
  } catch (error) {
    console.error("roomaddmember error:", error);
    return res.status(500).json({
      joined: false,
      message: "Server error",
    });
  }
});

module.exports = router;
