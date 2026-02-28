const { createClient } = require("redis");
const { createAdapter } = require("@socket.io/redis-adapter");
const MessageModel = require("../models/message");
const Message = MessageModel.default || MessageModel;
const User = require("../models/User");
const GeneralRoom = require("../models/GeneralRoom");
const CommunityRoom = require("../models/CommunityRoom.js");
const RoleAssignment = require("../models/RoleAssignment");
const ModerationReport = require("../models/ModerationReport");
const UserWarning = require("../models/UserWarning");
const { moderateMessage } = require("../utils/moderation");
const { checkIfUserIsBlocked } = require("../utils/blockingHelper");

const inMemory = {
  userSockets: new Map(),
  roomUsers: new Map(),
  identityRooms: new Map(),
  roomAnonIds: new Map(),
  anonMessageCooldownUntil: new Map(),
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
  const ANON_MESSAGE_COOLDOWN_MS = 10 * 1000;
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

  async function emitStaffOnlineUpdate(roomId) {
    try {
      const identities = await storage.getRoomIdentities(roomId);
      const userIds = identities
        .filter((id) => id.startsWith("u:"))
        .map((id) => id.slice(2));

      if (!userIds.length) {
        io.to(roomId).emit("staff_online_update", { staff: [] });
        return;
      }

      const roles = await RoleAssignment.find({
        user: { $in: userIds },
        role: { $in: ["moderator", "admin"] },
        revoked: false,
      })
        .select("user role")
        .lean();

      const roleMap = new Map();
      for (const entry of roles) {
        const uid = String(entry.user);
        const prev = roleMap.get(uid);
        if (!prev || (prev !== "admin" && entry.role === "admin")) {
          roleMap.set(uid, entry.role);
        }
      }

      const users = await User.find({ _id: { $in: userIds } })
        .select("_id anonId role")
        .lean();

      for (const user of users) {
        const uid = String(user._id);
        const roleFromUser = user.role;
        if (roleFromUser === "admin" || roleFromUser === "moderator") {
          const prev = roleMap.get(uid);
          if (!prev || (prev !== "admin" && roleFromUser === "admin")) {
            roleMap.set(uid, roleFromUser);
          }
        }
      }

      const staffIds = Array.from(roleMap.keys());
      if (!staffIds.length) {
        io.to(roomId).emit("staff_online_update", { staff: [] });
        return;
      }

      const staff = users
        .filter((u) => staffIds.includes(String(u._id)))
        .map((u) => ({
        anonId: u.anonId || `u:${u._id}`,
        role: roleMap.get(String(u._id)) || "moderator",
      }));

      io.to(roomId).emit("staff_online_update", { staff });
    } catch (err) {
      console.error("emitStaffOnlineUpdate error:", err);
    }
  }

  function getIdentity(socket) {
    if (socket.user && socket.user.id) return `u:${socket.user.id}`;
    if (socket.anonId) return `a:${socket.anonId}`;
    return `s:${socket.id}`;
  }

  function formatCityRoomName(city) {
    if (!city) return "Global";
    return city
      .toString()
      .trim()
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function getRemainingCooldownMs(identity) {
    const cooldownUntil = inMemory.anonMessageCooldownUntil.get(identity) || 0;
    return Math.max(0, cooldownUntil - Date.now());
  }

  function startCooldown(identity) {
    inMemory.anonMessageCooldownUntil.set(
      identity,
      Date.now() + ANON_MESSAGE_COOLDOWN_MS
    );
  }

  async function resolveSocketUser(socket) {
    const username = socket.user?.username;
    const userId = socket.user?.id;

    if (username) {
      return User.findOne({ username }).select("_id username city anonId role").lean();
    }

    if (userId) {
      return User.findById(userId).select("_id username city anonId role").lean();
    }

    return null;
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
      if (!msg) {
        socket.emit("system_message", "Message not found");
        return;
      }

      if (msg.roomType !== "general") return;

      const isMod = await isModerator(socket.user?.id, "general");
      const isSender = String(msg.senderId) === String(socket.anonId);

      if (!isSender && !isMod) return;

      const ROOM = msg.roomId || msg.room;

      await Message.findByIdAndDelete(messageId);

      // Always confirm deletion back to requester immediately.
      socket.emit("message_deleted", { messageId });

      if (ROOM) {
        io.to(ROOM).emit("message_deleted", { messageId });
      }

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

    socket.on("join_general", async (payload = {}) => {
      try {
        const user = await resolveSocketUser(socket);
        if (!user || !user.anonId) {
          return socket.emit("system_message", "Authentication required");
        }

        const requestedCity =
          typeof payload?.city === "string" ? payload.city.trim().toLowerCase() : "";
        const canOverrideCity = requestedCity && (await isModerator(user._id, "general"));
        const city = canOverrideCity
          ? requestedCity
          : (user.city && user.city.trim().toLowerCase()) || "global";
        const anonId = user.anonId;
        const ROOM = `general:${city}`;
        const generalRoomName = formatCityRoomName(city);

        socket.anonId = anonId;
        socket.join(ROOM);

        let room = await GeneralRoom.findOne({ city }).lean();

        if (!room) {
          await GeneralRoom.create({
            name: generalRoomName,
            city,
            members: 1,
            anonIds: [anonId],
          });
        } else {
          if (!room.name) {
            await GeneralRoom.updateOne(
              { city },
              { $set: { name: generalRoomName } }
            );
          }
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
        io.to(ROOM).emit("online_count", {
          count: await storage.getRoomOnlineCount(ROOM),
        });
        io.to(ROOM).emit("online_members", {
          members: await storage.getRoomIdentities(ROOM),
        });
        await emitStaffOnlineUpdate(ROOM);

        const deliveredIds = new Set();
        try {
          if (user && user._id) {
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
        const rooms = Array.from(socket.rooms).filter((r) => r.startsWith("general:"));
        if (!rooms.length) return socket.emit("system_message", "Not joined to a general room");
        const ROOM = rooms[0];
        const timestamp = Date.now();

        if (socket.user?.id) {
          const blockStatus = await checkIfUserIsBlocked(socket.user.id, socket.anonId);
          if (blockStatus.isBlocked) {
            socket.emit("user_blocked", {
              remainingMinutes: blockStatus.remainingMinutes,
              reason: blockStatus.reason,
              message: `You have been blocked by moderators for ${blockStatus.remainingMinutes} minutes.`,
              timestamp,
            });
            return;
          }
        }

        const remainingCooldownMs = getRemainingCooldownMs(identity);
        if (remainingCooldownMs > 0) {
          socket.emit("message_cooldown", {
            remainingSeconds: Math.ceil(remainingCooldownMs / 1000),
          });
          return;
        }
        startCooldown(identity);
        socket.emit("message_cooldown", { remainingSeconds: 10 });



        // ✅ SAFE MESSAGE - Broadcast to room
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

        (async () => {
          try {
            const moderationResult = await moderateMessage(message);
            if (moderationResult.isSafe) return;

            await Message.deleteOne({ _id: msgDoc._id });
            io.to(ROOM).emit("message_deleted", { messageId: msgDoc._id });

            if (socket.user?.id) {
              await UserWarning.create({
                userId: socket.user.id,
                anonId: socket.anonId,
                roomId: ROOM,
                roomType: "general",
                violationType: Object.keys(moderationResult.categories)[0],
                reason: moderationResult.warning,
                message: message.substring(0, 200),
              });
            }

            socket.emit("moderation_warning", {
              warning: moderationResult.warning,
              category: Object.keys(moderationResult.categories)[0],
              timestamp: Date.now(),
            });
          } catch (moderationErr) {
            console.error("general background moderation error:", moderationErr);
          }
        })();
      } catch (err) {
        console.error("send_message error:", err);
      }
    });

    socket.on("join_user_room", async ({ roomId, city: roomCityOverride }) => {
      try {
        if (!roomId || typeof roomId !== "string") {
          return socket.emit("system_message", "Invalid room");
        }

        roomId = roomId.trim().toLowerCase();
        const user = await resolveSocketUser(socket);
        if (!user || !user.anonId) {
          return socket.emit("system_message", "Authentication required");
        }
        const userIdString = String(user._id);

        const requestedCity =
          typeof roomCityOverride === "string" ? roomCityOverride.trim().toLowerCase() : "";
        const canOverrideCity = requestedCity && (await isModerator(user._id, "community"));
        const effectiveCity = canOverrideCity
          ? requestedCity
          : (user.city || "global").toLowerCase();

        socket.anonId = user.anonId;
        socket.city = effectiveCity;

        const fullRoomId = `anon_${socket.city}_${roomId}`;

        const community = await CommunityRoom.findOneAndUpdate(
          { roomId: fullRoomId },
          {
            roomId: fullRoomId,
            roomName: roomId.replace(/_/g, " ").toUpperCase(),
            city: effectiveCity,
            $addToSet: { anonIds: socket.anonId }
          },
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

        if (userIdString) {
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

        // 📏 Limit message to 120 characters for anonhub
        if (message.trim().length > 120) {
          return socket.emit("system_message", "Message should not exceed 120 characters");
        }

        const anonId = socket.anonId;
        if (!anonId) {
          return socket.emit("system_message", "Not a member of this room");
        }

        // 🔒 CHECK IF USER IS BLOCKED
        if (socket.user?.id) {
          const blockStatus = await checkIfUserIsBlocked(socket.user.id, anonId);
          if (blockStatus.isBlocked) {
            socket.emit("user_blocked", {
              remainingMinutes: blockStatus.remainingMinutes,
              reason: blockStatus.reason,
              message: `You have been blocked by moderators for ${blockStatus.remainingMinutes} minutes.`,
              timestamp: Date.now(),
            });
            return; // Don't process the message
          }
        }

        roomId = roomId.trim().toLowerCase();
        const fullRoomId = `anon_${socket.city.toLowerCase()}_${roomId}`;

        const members = await storage.getRoomIdentities(fullRoomId);

        if (!members.includes(identity)) {
          return socket.emit("system_message", "Not a member of this room");
        }

        const remainingCooldownMs = getRemainingCooldownMs(identity);
        if (remainingCooldownMs > 0) {
          socket.emit("message_cooldown", {
            remainingSeconds: Math.ceil(remainingCooldownMs / 1000),
          });
          return;
        }
        startCooldown(identity);
        socket.emit("message_cooldown", { remainingSeconds: 10 });

        // Broadcast first, then moderate asynchronously.
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

        (async () => {
          try {
            const moderationResult = await moderateMessage(message);
            if (moderationResult.isSafe) return;

            await Message.deleteOne({ _id: msgDoc._id });
            io.to(fullRoomId).emit("message_deleted", { messageId: msgDoc._id });

            if (socket.user?.id) {
              await UserWarning.create({
                userId: socket.user.id,
                anonId: anonId,
                roomId: fullRoomId,
                roomType: "community",
                violationType: Object.keys(moderationResult.categories)[0],
                reason: moderationResult.warning,
                message: message.substring(0, 200),
              });
            }

            socket.emit("moderation_warning", {
              warning: moderationResult.warning,
              category: Object.keys(moderationResult.categories)[0],
              timestamp: Date.now(),
            });
          } catch (moderationErr) {
            console.error("community background moderation error:", moderationErr);
          }
        })();

      } catch (err) {
        console.error("send_room_message error:", err);
      }
    });


    socket.on("disconnect", async () => {
      try {
        await storage.removeSocketFromIdentity(identity, socket.id);
        const stillHas = await storage.identityHasSockets(identity);

        if (!stillHas) {
          inMemory.anonMessageCooldownUntil.delete(identity);
          const rooms = await storage.getIdentityRooms(identity);
          for (const r of rooms) {
            await storage.removeIdentityFromRoom(r, identity);
            await storage.removeRoomFromIdentity(identity, r);
            io.to(r).emit("system_message", "A user left");
            io.to(r).emit("online_count", { count: await storage.getRoomOnlineCount(r) });
            await emitStaffOnlineUpdate(r);
          }
        }
      } catch (err) {
        console.warn("Error during disconnect cleanup:", err);
      }
    });
  };
};


