const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.js");
const User = require("../models/User.js");
const CommunityRoom = require("../models/CommunityRoom.js");


router.get("/data", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId).select("city anonId");

    if (!user || !user.city) {
      return res.status(404).json({ message: "User or city not found" });
    }


    const city = user.city.toLowerCase();
    const anonId = user.anonId;

    const rooms = await CommunityRoom.find({
      city,
      isActive: true,
    }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      city,
      anonId,
      rooms,
    });
  } catch (error) {
    console.error("Rooms fetch error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.delete("/room/:roomId", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;
    const { reason } = req.body;

    const room = await CommunityRoom.findOne({ roomId });

    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    // 🔐 Owner check
    if (room.createdBy.toString() !== userId) {
      return res.status(403).json({ message: "Not authorized" });
    }

    // ✅ Soft delete
    room.isActive = false;
    await room.save();

    // 🔔 Creator system message (socket)
    const systemMsg = `Room "${room.roomName}" was deleted by ${req.user.anonId}. Reason: ${reason || "No reason provided"}`;

    // NOTE: io global hona chahiye (app.js me set)
    global.io?.to(room.createdBy.toString()).emit("system_message", systemMsg);

    return res.json({
      success: true,
      message: "Room deleted successfully",
    });
  } catch (err) {
    console.error("Delete room error:", err);
    res.status(500).json({ message: "Server error" });
  }
});


router.post("/create-room", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { roomName, status, description } = req.body;

    if (!roomName) {
      return res.status(400).json({ message: "Room name is required" });
    }

    const ROOM_REGEX = /^[a-z0-9-]+$/;
    if (!ROOM_REGEX.test(roomName)) {
      return res.status(400).json({
        message: "Invalid room name format",
      });
    }

    const user = await User.findById(userId).select("city anonId");
    if (!user || !user.city) {
      return res.status(400).json({ message: "City not set" });
    }

    const city = user.city.toLowerCase();
    const anonId = user.anonId;
    const roomId = `anon_${city}_${roomName}`;

    const exists = await CommunityRoom.findOne({ roomId });
    if (exists) {
      return res.status(409).json({ message: "Room already exists" });
    }

    const room = await CommunityRoom.create({
      roomId,
      roomName,
      city,
      anonId,
      status: status || "public",
      description,
      createdBy: userId,
      totalMembers: 1,
      onlineMembers: 1,
      isActive: true,
    });

    res.status(201).json({
      success: true,
      room,
    });
  } catch (error) {
    console.error("Create room error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/my-rooms", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const rooms = await CommunityRoom.find({
      createdBy: userId,
      isActive: true,
    }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      rooms,
    });
  } catch (error) {
    console.error("My rooms fetch error:", error);
    res.status(500).json({ message: "Server error" });
  }
});
router.delete("/room/:roomId", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;

    const room = await CommunityRoom.findOne({ roomId });

    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    // 🔐 Owner check
    if (room.createdBy.toString() !== userId) {
      return res.status(403).json({ message: "Not authorized" });
    }

    // ✅ Soft delete
    room.isActive = false;
    await room.save();

    res.json({
      success: true,
      message: "Room deleted",
    });
  } catch (err) {
    console.error("Delete room error:", err);
    res.status(500).json({ message: "Server error" });
  }
});
router.put("/room/:roomId", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;
    const { description, roomType } = req.body;

    const room = await CommunityRoom.findOne({ roomId });

    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    if (room.createdBy.toString() !== userId) {
      return res.status(403).json({ message: "Not authorized" });
    }

    if (roomType) {
      room.roomType = roomType; // public / private
    }

    if (description !== undefined) {
      room.description = description;
    }

    await room.save();

    res.json({
      success: true,
      room,
    });
  } catch (err) {
    console.error("Edit room error:", err);
    res.status(500).json({ message: "Server error" });
  }
});


module.exports = router;
