const express = require("express");
const router = express.Router();
const Room = require("../models/Room");
const auth = require("../middleware/auth");

/**
 * POST /api/rooms/create
 * Create a new room
 * Body: { roomId, name, city }
 */
router.post("/create", auth, async (req, res) => {
  try {
    const { roomId, name, city } = req.body;

    if (!roomId) {
      return res.status(400).json({ message: "roomId is required" });
    }

    // Normalize roomId
    const normalizedRoomId = roomId.trim().toLowerCase();

    // Check if room already exists
    const existingRoom = await Room.findOne({ roomId: normalizedRoomId });
    if (existingRoom) {
      return res.status(409).json({ message: "Room already exists" });
    }

    // Create new room
    const newRoom = new Room({
      roomId: normalizedRoomId,
      name: name || normalizedRoomId,
      city: city || "",
      active: true,
    });

    await newRoom.save();

    res.status(201).json({
      message: "Room created successfully",
      room: newRoom,
    });
  } catch (err) {
    console.error("❌ Error creating room:", err.message);
    res.status(500).json({ message: "Server error: " + err.message });
  }
});

/**
 * GET /api/rooms/:roomId
 * Get room details
 */
router.get("/:roomId", async (req, res) => {
  try {
    const { roomId } = req.params;
    const normalizedRoomId = roomId.trim().toLowerCase();

    const room = await Room.findOne({ roomId: normalizedRoomId }).lean();

    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    res.json({ room });
  } catch (err) {
    console.error("❌ Error fetching room:", err.message);
    res.status(500).json({ message: "Server error: " + err.message });
  }
});

/**
 * PUT /api/rooms/:roomId/toggle-active
 * Toggle room active status (Admin only)
 */
router.put("/:roomId/toggle-active", auth,  async (req, res) => {
  try {
    const { roomId } = req.params;
    const normalizedRoomId = roomId.trim().toLowerCase();

    const room = await Room.findOne({ roomId: normalizedRoomId });

    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    room.active = !room.active;
    await room.save();

    res.json({
      message: `Room is now ${room.active ? "active" : "inactive"}`,
      room,
    });
  } catch (err) {
    console.error("❌ Error toggling room:", err.message);
    res.status(500).json({ message: "Server error: " + err.message });
  }
});

/**
 * GET /api/rooms
 * Get all rooms (optional filtering by city)
 */
router.get("/", async (req, res) => {
  try {
    const { city, active } = req.query;
    const filter = {};

    if (city) filter.city = city.toLowerCase();
    if (active !== undefined) filter.active = active === "true";

    const rooms = await Room.find(filter).lean();

    res.json({ rooms });
  } catch (err) {
    console.error("❌ Error fetching rooms:", err.message);
    res.status(500).json({ message: "Server error: " + err.message });
  }
});

module.exports = router;
