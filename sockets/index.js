const { createClient } = require("redis");
const { createAdapter } = require("@socket.io/redis-adapter");
const MessageModel = require("../models/message");
const Message = MessageModel.default || MessageModel;
const User = require("../models/User");
const Room = require("../models/Room");
const GeneralRoom = require("../models/GeneralRoom");
const CommunityRoom = require("../models/CommunityRoom.js");
const RoleAssignment = require("../models/RoleAssignment");
const ModerationReport = require("../models/ModerationReport");

const inMemory = {
  userSockets: new Map(),
  roomUsers: new Map(),
  identityRooms: new Map(),
  roomAnonIds: new Map(),
};

const k = {
  userSockets: (identity) => `userSockets:${identity}`,
  roomUsers: (roomId) => `roomUsers:${roomId}`,
  identityRooms: (identity) => `identityRooms:${identity}`,
  roomAnonId: (roomId, identity) => `roomAnonId:${roomId}:${identity}`,
};

async function initRedisAdapter(io) {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;

  const pubClient = createClient({ url: redisUrl });
  const subClient = pubClient.duplicate();

  await Promise.all([pubClient.connect(), subClient.connect()]);

  io.adapter(createAdapter(pubClient, subClient));
  return { pubClient, subClient };
}

module.exports = function setupSocketHandlers(io, redisClient) {
  let redis = redisClient;

  const useRedis = !!process.env.REDIS_URL;

  if (useRedis && !redis) {
    const client = createClient({ url: process.env.REDIS_URL });
    client.connect().catch((err) => {
      console.error("Failed to connect to Redis:", err);
    });
    redis = client;

    initRedisAdapter(io).catch((err) => console.warn("Redis adapter init failed:", err));
  }

  const storage = {
    async addSocketToIdentity(identity, socketId) {
      if (redis) return redis.sAdd(k.userSockets(identity), socketId);
      if (!inMemory.userSockets.has(identity)) inMemory.userSockets.set(identity, new Set());
      inMemory.userSockets.get(identity).add(socketId);
      return 1;
    },
    async removeSocketFromIdentity(identity, socketId) {
      if (redis) return redis.sRem(k.userSockets(identity), socketId);
      const s = inMemory.userSockets.get(identity);
      if (!s) return 0;
      s.delete(socketId);
      if (s.size === 0) inMemory.userSockets.delete(identity);
      return 1;
    },
    async getSocketsForIdentity(identity) {
      if (redis) return (await redis.sMembers(k.userSockets(identity))) || [];
      return Array.from(inMemory.userSockets.get(identity) || []);
    },
    async identityHasSockets(identity) {
      if (redis) return (await redis.sCard(k.userSockets(identity))) > 0;
      return (inMemory.userSockets.get(identity) || new Set()).size > 0;
    },

    async addIdentityToRoom(roomId, identity) {
      if (redis) return redis.sAdd(k.roomUsers(roomId), identity);
      if (!inMemory.roomUsers.has(roomId)) inMemory.roomUsers.set(roomId, new Set());
      inMemory.roomUsers.get(roomId).add(identity);
      if (!inMemory.identityRooms.has(identity)) inMemory.identityRooms.set(identity, new Set());
      inMemory.identityRooms.get(identity).add(roomId);
      return 1;
    },
    async removeIdentityFromRoom(roomId, identity) {
      if (redis) return redis.sRem(k.roomUsers(roomId), identity);
      const s = inMemory.roomUsers.get(roomId);
      if (!s) return 0;
      s.delete(identity);
      if (s.size === 0) inMemory.roomUsers.delete(roomId);
      const ir = inMemory.identityRooms.get(identity);
      ir && ir.delete(roomId);
      return 1;
    },
    async getRoomIdentities(roomId) {
      if (redis) return (await redis.sMembers(k.roomUsers(roomId))) || [];
      return Array.from(inMemory.roomUsers.get(roomId) || []);
    },
    async getRoomOnlineCount(roomId) {
      if (redis) return (await redis.sCard(k.roomUsers(roomId))) || 0;
      return (inMemory.roomUsers.get(roomId) || new Set()).size;
    },

    async addRoomToIdentity(identity, roomId) {
      if (redis) return redis.sAdd(k.identityRooms(identity), roomId);
      if (!inMemory.identityRooms.has(identity)) inMemory.identityRooms.set(identity, new Set());
      inMemory.identityRooms.get(identity).add(roomId);
      return 1;
    },
    async removeRoomFromIdentity(identity, roomId) {
      if (redis) return redis.sRem(k.identityRooms(identity), roomId);
      const s = inMemory.identityRooms.get(identity);
      if (!s) return 0;
      s.delete(roomId);
      if (s.size === 0) inMemory.identityRooms.delete(identity);
      return 1;
    },
    async getIdentityRooms(identity) {
      if (redis) return (await redis.sMembers(k.identityRooms(identity))) || [];
      return Array.from(inMemory.identityRooms.get(identity) || []);
    },


  };

  async function isModerator(userId, roomType, roomId) {
    if (!userId) return false;

    try {
      const role = await RoleAssignment.findOne({
        user: userId,
        role: { $in: ['moderator', 'admin'] },
        revoked: false
      }).lean();

      return !!role;
    } catch (err) {
      console.error("Error checking moderator status:", err);
      return false;
    }
  }

  function getIdentity(socket) {
    if (socket.user && socket.user.id) return `u:${socket.user.id}`;
    if (socket.anonId) return `a:${socket.anonId}`;
    return `s:${socket.id}`;
  }

  return async function attachAll(socket) {


    socket.on("report_message", async ({ roomId, roomType, messageId }) => {
      await ModerationReport.create({
        roomId,
        roomType,
        messageId,
        reportedBy: socket.identity,
      });
    });


    socket.on("delete_message", async ({ roomId, roomType, messageId }) => {
      try {
        const msg = await Message.findById(messageId);
        if (!msg) return;

        const allowed =
          msg.senderId === socket.anonId ||
          await isModerator(socket.user?.id, roomType, roomId);

        if (!allowed) return;

        await Message.deleteOne({ _id: messageId });

        // Emit to the message's room
        io.to(msg.roomId).emit("message_deleted", { messageId });

        // Emit to moderator's sockets as well, in case they are not in the room
        if (await isModerator(socket.user?.id, roomType, roomId)) {
          const modIdentity = `u:${socket.user.id}`;
          const modSockets = await storage.getSocketsForIdentity(modIdentity);
          for (const sid of modSockets) {
            io.to(sid).emit("message_deleted", { messageId });
          }
        }
      } catch (err) {
        console.error(err);
      }
    });
  socket.on("general_delete_message", async ({ messageId }) => {
    try {
      const msg = await Message.findById(messageId);
      if (!msg) return;

      if (msg.roomType !== "general") return;

      const isMod = await isModerator(socket.user?.id, "general");
      const isSender = msg.senderId === socket.anonId;

      if (!isSender && !isMod) return;

      const ROOM = msg.room;

      await Message.findByIdAndDelete(messageId);

      io.to(ROOM).emit("message_deleted", { messageId });

      // Emit to moderator's sockets as well, in case they are not in the room
      if (isMod) {
        const modIdentity = `u:${socket.user.id}`;
        const modSockets = await storage.getSocketsForIdentity(modIdentity);
        for (const sid of modSockets) {
          io.to(sid).emit("message_deleted", { messageId });
        }
      }

      if (isMod && !isSender) {
        const senderIdentity = `a:${msg.senderId}`;
        const senderSockets = await storage.getSocketsForIdentity(senderIdentity);

        for (const sid of senderSockets) {
          io.to(sid).emit("message_deleted_for_sender", {
            messageId,
            text: "🛡 Deleted by moderator",
          });
        }
      }

    } catch (err) {
      console.error("Delete error:", err);
    }
  });




    socket.on("suspend_user", ({ targetAnonId }) => {
      console.log("⛔ Suspend user:", {
        targetAnonId,
        by: socket.identity,
      });

    });

    socket.on("ban_user", async ({ targetAnonId, roomId, roomType }) => {
      if (!(await isModerator(socket.user?.id, roomType, roomId))) return;

      if (roomType === "community") {
        await CommunityRoom.updateOne(
          { roomId },
          { $addToSet: { bannedAnonIds: targetAnonId } }
        );
      }

      if (roomType === "general") {
        await GeneralRoom.updateOne(
          { city: socket.city },
          { $addToSet: { bannedAnonIds: targetAnonId } }
        );
      }

      io.to(roomId).emit("system_message", "User banned");
    });


    socket.on("slow_mode_toggle", async () => {
      try {
        const userId = socket.user?.id;
        if (!userId) return socket.emit("system_message", "Authentication required");

        const user = await User.findById(userId).select("city").lean();
        if (!user || !user.city) return socket.emit("system_message", "User city not found");

        const city = user.city.toLowerCase();
        const ROOM = `general:${city}`;

        const role = await RoleAssignment.findOne({ user: userId, role: { $in: ['moderator', 'admin'] }, revoked: false }).lean();
        if (!role) return socket.emit("system_message", "Insufficient permissions");

        const room = await GeneralRoom.findOne({ city });
        if (!room) return socket.emit("system_message", "Room not found");

        const newSlowMode = !room.slowMode;
        await GeneralRoom.updateOne({ city }, { slowMode: newSlowMode });

        io.to(ROOM).emit("slow_mode_update", { slowMode: newSlowMode });
        socket.emit("system_message", `Slow mode ${newSlowMode ? 'enabled' : 'disabled'}`);
      } catch (err) {
        console.error("slow_mode_toggle error:", err);
        socket.emit("system_message", "Failed to toggle slow mode");
      }
    });

    socket.on("clear_chat_history", async () => {
      try {
        const userId = socket.user?.id;
        if (!userId) return socket.emit("system_message", "Authentication required");

        const user = await User.findById(userId).select("city").lean();
        if (!user || !user.city) return socket.emit("system_message", "User city not found");

        const city = user.city.toLowerCase();
        const ROOM = `general:${city}`;

        const role = await RoleAssignment.findOne({ user: userId, role: { $in: ['moderator', 'admin'] }, revoked: false }).lean();
        if (!role) return socket.emit("system_message", "Insufficient permissions");

        const since = new Date(Date.now() - 1000 * 60 * 60 * 24);
        await Message.deleteMany({ roomType: "general", city, sentAt: { $gte: since } });

        io.to(ROOM).emit("chat_cleared");
        socket.emit("system_message", "Chat history cleared");
      } catch (err) {
        console.error("clear_chat_history error:", err);
        socket.emit("system_message", "Failed to clear chat history");
      }
    });

    const identity = getIdentity(socket);
    socket.identity = identity;

    try {
      await storage.addSocketToIdentity(identity, socket.id);

    } catch (err) {
      console.warn("Failed to add socket to identity storage:", err);
    }

    socket.on("join_general", async () => {
      try {
        const userId = socket.user && socket.user.id;
        if (!userId) {
          return socket.emit("system_message", "Authentication required to join general rooms");
        }

        const user = await User.findById(userId).select("city anonId").lean();
        if (!user) {
          return socket.emit("system_message", "User not found");
        }

        const city = (user && user.city && user.city.trim().toLowerCase()) || "global";
        const anonId = (user && user.anonId) || null;
        const ROOM = `general:${city}`;

        socket.anonId = anonId;
        socket.join(ROOM);

        let room = await GeneralRoom.findOne({ city }).lean();

        if (!room) {
          await GeneralRoom.create({
            city,
            members: 1,
            anonIds: [anonId],
          });
        } else {
          if (!room.anonIds.includes(anonId)) {
            await GeneralRoom.updateOne(
              { city },
              {
                $addToSet: { anonIds: anonId },
                $inc: { members: 1 },
              }
            );
          }
        }

        const wasPresent = (await storage.getRoomIdentities(ROOM)).includes(identity);
        await storage.addIdentityToRoom(ROOM, identity);
        await storage.addRoomToIdentity(identity, ROOM);

        if (!wasPresent) {
          socket.to(ROOM).emit("system_message", "A user joined");

          io.to(ROOM).emit("online_count", {
            count: await storage.getRoomOnlineCount(ROOM),
          });

          io.to(ROOM).emit("online_members", {
            members: await storage.getRoomIdentities(ROOM),
          });
        }

        const deliveredIds = new Set();
        try {
          const pending = await Message.find({ city, pendingFor: user._id }).sort({ sentAt: 1 }).lean();
          if (pending && pending.length) {
            for (const msg of pending) {
              const payload = {
                id: msg._id,
                message: msg.text || "",
                time: msg.sentAt || msg.createdAt || Date.now(),
                anonId: msg.senderId || null,
              };
              socket.emit("receive_message", payload);
              deliveredIds.add(String(msg._id));
              await Message.updateOne({ _id: msg._id }, { $pull: { pendingFor: user._id }, $addToSet: { deliveredTo: user._id } });
            }
          }
        } catch (err) {
          console.warn("Failed to deliver pending messages:", err);
        }

        try {
          const since = new Date(Date.now() - 1000 * 60 * 60 * 24);
          const history = await Message.find({ roomType: "general", city, sentAt: { $gte: since } })
            .sort({ sentAt: -1 })
            .limit(200)
            .lean();

          if (history && history.length) {
            for (const msg of history.reverse()) {
              if (deliveredIds.has(String(msg._id))) continue;

              const payload = {
                id: msg._id,
                message: msg.text,
                time: msg.sentAt || msg.createdAt || Date.now(),
                user: msg.senderId,
              };

              socket.emit("receive_message", payload);
            }
          }
        } catch (err) {
          console.warn("Failed to fetch general history:", err);
        }

        socket.emit("general_ready", { anonId, room: ROOM });
      } catch (err) {
        console.error("join_general error:", err);
        socket.emit("system_message", "Unable to join general room");
      }
    });

    socket.on("send_message", async (message) => {
      if (!message || typeof message !== "string" || !message.trim()) return;
      try {
        if (!socket.user || !socket.user.id) return socket.emit("system_message", "Authentication required");
        const rooms = Array.from(socket.rooms).filter((r) => r.startsWith("general:"));
        if (!rooms.length) return socket.emit("system_message", "Not joined to a general room");
        const ROOM = rooms[0];
        const timestamp = Date.now();

        const cityName = ROOM.replace(/^general:/, "");
        const msgDoc = new Message({
          senderType: "anonymous",
          senderId: socket.anonId || null,
          text: message,
          city: cityName,
          roomType: "general",
          roomId: ROOM,
          roomName: "general",
          sentAt: timestamp,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
          pendingFor: [],
        });

        const identities = await storage.getRoomIdentities(ROOM);
        const pendingUserIds = [];

        for (const iden of identities) {
          if (iden === identity) continue;
          if (iden.startsWith("u:")) {
            const uid = iden.slice(2);
            pendingUserIds.push(uid);
          }
        }

        if (pendingUserIds.length) msgDoc.pendingFor = pendingUserIds;
        await msgDoc.save();

        for (const iden of identities) {
          const sockets = await storage.getSocketsForIdentity(iden);
          if (!sockets || sockets.length === 0) continue;

          if (iden === identity) {
            socket.emit("receive_message", {
              id: msgDoc._id,
              message: msgDoc.text,
              time: msgDoc.sentAt || msgDoc.createdAt || Date.now(),
              user: msgDoc.senderId,
            });
          } else {
            const targetSocketId = sockets[0];
            io.to(targetSocketId).emit("receive_message", {
              id: msgDoc._id,
              message: msgDoc.text,
              time: msgDoc.sentAt || msgDoc.createdAt || Date.now(),
              user: msgDoc.senderId,
            });
          }
        }
      } catch (err) {
        console.error("send_message error:", err);
      }
    });

    socket.on("join_user_room", async ({ roomId }) => {
      try {
        if (!roomId || typeof roomId !== "string") {
          return socket.emit("system_message", "Invalid room");
        }

        const authUserId = socket.user?.id;
        if (!authUserId) {
          return socket.emit("system_message", "Authentication required");
        }

        roomId = roomId.trim().toLowerCase();
        const userIdString = String(authUserId);

        const user = await User.findById(authUserId)
          .select("city anonId")
          .lean();

        if (!user || !user.anonId) {
          return socket.emit("system_message", "User not found");
        }

        socket.anonId = user.anonId;
        socket.city = user.city;

        const fullRoomId = `anon_${user.city.toLowerCase()}_${roomId}`;

        let room = await Room.findOne({ roomId }).lean();

        if (!room) {
          const created = await Room.create({
            roomId,
            name: roomId.replace(/_/g, " ").toUpperCase(),
            city: (user.city || "").toLowerCase(),
            active: true,
          });
          room = created.toObject();
        }

        if (!room.active) {
          return socket.emit("system_message", "Room not available");
        }

        if (
          (room.city || "").trim().toLowerCase() !==
          (user.city || "").trim().toLowerCase()
        ) {
          return socket.emit("system_message", "Room belongs to another city");
        }

        await Room.updateOne(
          { roomId },
          { $addToSet: { users: userIdString } }
        );

        const community = await CommunityRoom.findOneAndUpdate(
          { roomId: fullRoomId },
          { $addToSet: { anonIds: socket.anonId } },
          { upsert: true, new: true }
        );

        await CommunityRoom.updateOne(
          { roomId: fullRoomId },
          { $set: { members: community.anonIds.length } }
        );

        socket.join(fullRoomId);

        const wasPresent = (await storage.getRoomIdentities(fullRoomId))
          .includes(identity);

        await storage.addIdentityToRoom(fullRoomId, identity);
        await storage.addRoomToIdentity(identity, fullRoomId);


        if (!wasPresent) {
          socket.to(fullRoomId).emit("system_message", "A user joined");
        }

        const deliveredIds = new Set();

        const pending = await Message.find({
          roomId: fullRoomId,
          pendingFor: userIdString,
        })
          .sort({ sentAt: 1 })
          .lean();

        for (const msg of pending) {
          socket.emit("receive_message", {
            id: msg._id,
            message: msg.text,
            time: msg.sentAt || msg.createdAt,
            user: msg.senderId,
          });

          deliveredIds.add(String(msg._id));

          await Message.updateOne(
            { _id: msg._id },
            {
              $pull: { pendingFor: userIdString },
              $addToSet: { deliveredTo: userIdString },
            }
          );
        }

        io.to(fullRoomId).emit("online_count", {
          count: await storage.getRoomOnlineCount(fullRoomId),
        });

        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const history = await Message.find({
          roomId: fullRoomId,
          roomType: "community",
          sentAt: { $gte: since },
        })
          .sort({ sentAt: 1 })
          .limit(200)
          .lean();

        for (const msg of history) {
          if (deliveredIds.has(String(msg._id))) continue;

          socket.emit("receive_message", {
            id: msg._id,
            message: msg.text,
            time: msg.sentAt,
            user: msg.senderId,
          });
        }

        socket.emit("room_ready", {
          roomId,
          roomAnonId: socket.anonId,
        });

      } catch (err) {
        console.error("join_user_room failed:", err);
        socket.emit("system_message", "Unable to join room");
      }
    });


    socket.on("leave_user_room", async ({ roomId }) => {
      try {
        if (!roomId || typeof roomId !== "string") return;
        if (!socket.anonId || !socket.user?.id) return;

        roomId = roomId.trim().toLowerCase();
        const fullRoomId = `anon_${socket.city.toLowerCase()}_${roomId}`;

        const wasInRoom = (await storage.getRoomIdentities(fullRoomId)).includes(identity);
        if (!wasInRoom) return;

        await Promise.all([
          storage.removeIdentityFromRoom(fullRoomId, identity),
          storage.removeRoomFromIdentity(identity, fullRoomId),
        ]);

        const community = await CommunityRoom.findOneAndUpdate(
          { roomId: fullRoomId },
          { $pull: { anonIds: socket.anonId } },
          { new: true }
        ).lean();

        await CommunityRoom.updateOne(
          { roomId: fullRoomId },
          { $set: { members: community?.anonIds.length || 0 } }
        );

        socket.leave(fullRoomId);

        socket.to(fullRoomId).emit("system_message", "A user left");

        io.to(fullRoomId).emit("online_count", {
          count: await storage.getRoomOnlineCount(fullRoomId),
        });

      } catch (error) {
        console.error("leave_user_room failed:", error);
      }
    });



    socket.on("send_room_message", async ({ roomId, message }) => {
      try {
        if (!roomId || !message?.trim()) return;

        const anonId = socket.anonId;
        if (!anonId) {
          return socket.emit("system_message", "Not a member of this room");
        }

        roomId = roomId.trim().toLowerCase();
        const fullRoomId = `anon_${socket.city.toLowerCase()}_${roomId}`;

        const members = await storage.getRoomIdentities(fullRoomId);

        if (!members.includes(identity)) {
          return socket.emit("system_message", "Not a member of this room");
        }

        const msgDoc = await Message.create({
          senderType: "anonymous",
          senderId: anonId,
          text: message,
          roomId: fullRoomId,
          roomType: "community",
          sentAt: new Date(),
        });

        for (const memberAnonId of members) {
          const sockets = await storage.getSocketsForIdentity(memberAnonId);
          for (const sid of sockets) {
            io.to(sid).emit("receive_message", {
              id: msgDoc._id,
              message: msgDoc.text,
              time: msgDoc.sentAt,
              user: anonId,
            });
          }
        }

      } catch (err) {
        console.error("send_room_message error:", err);
      }
    });


    socket.on("disconnect", async () => {
      try {
        await storage.removeSocketFromIdentity(identity, socket.id);
        const stillHas = await storage.identityHasSockets(identity);

        if (!stillHas) {
          const rooms = await storage.getIdentityRooms(identity);
          for (const r of rooms) {
            await storage.removeIdentityFromRoom(r, identity);
            await storage.removeRoomFromIdentity(identity, r);
            io.to(r).emit("system_message", "A user left");
            io.to(r).emit("online_count", { count: await storage.getRoomOnlineCount(r) });
          }
        }
      } catch (err) {
        console.warn("Error during disconnect cleanup:", err);
      }
    });
  };
};