/**
 * Socket.IO Configuration - Chat Service
 * Integrado con Firebase Auth, User Profile Service y Matchmaking Service
 */

const { createAdapter } = require("@socket.io/redis-adapter");
const Redis = require("ioredis");
const RoomManager = require("./roomManager");
const auth = require("./auth");
const userService = require("./userService");
const config = require("./config");

module.exports = async function setupSocket(server) {
  const io = require("socket.io")(server, {
    cors: { origin: "*" }
  });

  //  Redis clients 
  const pubClient = new Redis(config.REDIS_URL);
  const subClient = new Redis(config.REDIS_URL);

  // Adapter para múltiples instancias
  io.adapter(createAdapter(pubClient, subClient));

  const roomManager = new RoomManager(pubClient);

  //  Suscribirse a eventos de matchmaking 
  setupMatchmakingListener(pubClient, roomManager);

  // AUTH MIDDLEWARE
  io.use(async (socket, next) => {
    try {
      const check = await auth.validateConnectionPayload(socket.handshake);
      
      if (!check.ok) {
        return next(new Error(check.reason));
      }

      // Guardar datos del usuario en el socket
      socket.data.user = check.user;

      // Obtener nombre del perfil (si no viene en modo dev)
      if (!check.user.username && check.user.oduserId) {
        const displayName = await userService.getDisplayName(
          check.user.oduserId,
          `User_${check.user.oduserId.slice(-6)}`
        );
        socket.data.user.username = displayName;
      }

      next();
    } catch (error) {
      console.error("[SOCKET] Auth error:", error);
      next(new Error("authentication failed"));
    }
  });

  // CONNECTION HANDLER
  io.on("connection", (socket) => {
    const { oduserId, username } = socket.data.user;
    console.log(`[SOCKET] Connected: ${username} (${oduserId}) - ${socket.id}`);

    // JOIN ROOM
    socket.on("room:join", async (payload, cb) => {
      try {
        const { roomId } = payload || {};
        
        if (!roomId) {
          return cb?.({ ok: false, msg: "roomId required" });
        }

        // Verificar si puede unirse a la sala
        const canJoin = await roomManager.canUserJoinRoom(roomId, oduserId);
        
        if (!canJoin.allowed) {
          console.warn(`[SOCKET] ${username} no puede unirse a ${roomId}: ${canJoin.reason}`);
          return cb?.({ ok: false, msg: canJoin.reason });
        }

        // Unirse a la sala de Socket.IO
        socket.join(roomId);
        
        // Registrar en Redis
        await roomManager.addUserToRoom(roomId, oduserId);

        // Obtener historial de mensajes
        const lastMessages = await roomManager.getLastMessages(roomId, config.HISTORY_LIMIT);
        
        // Responder con éxito
        cb?.({
          ok: true,
          roomId,
          last: lastMessages.map((m) => m.message)
        });

        // Notificar a otros en la sala
        socket.to(roomId).emit("system", {
          type: "user_joined",
          text: `${username} se unió al chat`,
          oduserId,
          username,
          timestamp: Date.now()
        });

        console.log(`[SOCKET] ${username} joined room: ${roomId}`);
      } catch (err) {
        console.error("[SOCKET] room:join error:", err);
        cb?.({ ok: false, msg: err.message });
      }
    });

    // LEAVE ROOM
    socket.on("room:leave", async (payload) => {
      try {
        const { roomId } = payload || {};
        
        if (!roomId) return;

        socket.leave(roomId);
        await roomManager.removeUserFromRoom(roomId, oduserId);

        socket.to(roomId).emit("system", {
          type: "user_left",
          text: `${username} salió del chat`,
          oduserId,
          username,
          timestamp: Date.now()
        });

        console.log(`[SOCKET] ${username} left room: ${roomId}`);
      } catch (err) {
        console.error("[SOCKET] room:leave error:", err);
      }
    });

    // CHAT MESSAGE
    socket.on("chat:message", async (payload, cb) => {
      try {
        const { roomId, text } = payload || {};

        if (!roomId || !text) {
          return cb?.({ ok: false, msg: "roomId + text required" });
        }

        // Limpiar texto
        const cleanText = String(text).slice(0, config.MAX_MSG_LENGTH).trim();
        
        if (!cleanText) {
          return cb?.({ ok: false, msg: "empty message" });
        }

        // Verificar rate limit
        const allowed = await roomManager.checkRateLimit(oduserId);
        
        if (!allowed) {
          return cb?.({ ok: false, msg: "rate limit exceeded" });
        }

        // Crear mensaje
        const msg = {
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          from: username,
          oduserId: oduserId,
          text: cleanText,
          timestamp: Date.now()
        };

        // Guardar en Redis
        await roomManager.saveMessage(roomId, msg);

        // Emitir a todos en la sala (incluyendo el sender)
        io.to(roomId).emit("chat:message", msg);

        cb?.({ ok: true, messageId: msg.id });
      } catch (err) {
        console.error("[SOCKET] chat:message error:", err);
        cb?.({ ok: false, msg: err.message });
      }
    });

    // TYPING INDICATOR
    socket.on("chat:typing", (payload) => {
      const { roomId, isTyping } = payload || {};
      
      if (!roomId) return;

      socket.to(roomId).emit("chat:typing", {
        oduserId,
        username,
        isTyping: Boolean(isTyping)
      });
    });

    // GET USER INFO
    socket.on("user:info", async (payload, cb) => {
      try {
        const { oduserId: targetUserId } = payload || {};
        
        if (!targetUserId) {
          return cb?.({ ok: false, msg: "oduserId required" });
        }

        const profile = await userService.getProfileByFirebaseUid(targetUserId);
        
        if (!profile) {
          return cb?.({ ok: false, msg: "user not found" });
        }

        cb?.({
          ok: true,
          user: {
            oduserId: profile.firebaseUid,
            name: profile.name,
            country: profile.country
          }
        });
      } catch (err) {
        console.error("[SOCKET] user:info error:", err);
        cb?.({ ok: false, msg: err.message });
      }
    });

    // DISCONNECT
    socket.on("disconnect", async (reason) => {
      console.log(`[SOCKET] Disconnected: ${username} (${reason})`);

      try {
        // Obtener salas del usuario y notificar
        const userRooms = await roomManager.getUserRooms(oduserId);
        
        for (const roomId of userRooms) {
          socket.to(roomId).emit("system", {
            type: "user_disconnected",
            text: `${username} se desconectó`,
            oduserId,
            username,
            timestamp: Date.now()
          });
          
          await roomManager.removeUserFromRoom(roomId, oduserId);
        }
      } catch (err) {
        console.error("[SOCKET] disconnect cleanup error:", err);
      }
    });

    // ERROR HANDLER
    socket.on("error", (error) => {
      console.error(`[SOCKET] Error for ${username}:`, error);
    });
  });

  return io;
};

// MATCHMAKING EVENT LISTENER
function setupMatchmakingListener(redisClient, roomManager) {
  const subscriber = new Redis(config.REDIS_URL);

  subscriber.subscribe(config.CHANNELS.ROOM_NOTIFICATIONS, (err) => {
    if (err) {
      console.error("[CHAT] Error subscribing to matchmaking events:", err);
      return;
    }
    console.log(`[CHAT] Subscribed to: ${config.CHANNELS.ROOM_NOTIFICATIONS}`);
  });

  subscriber.on("message", async (channel, message) => {
    if (channel !== config.CHANNELS.ROOM_NOTIFICATIONS) return;

    try {
      const event = JSON.parse(message);
      
      console.log(`[CHAT] Room notification received:`, {
        roomId: event.roomId,
        players: event.players,
        mode: event.mode
      });

      // Crear automáticamente la sala de chat
      await roomManager.createChatRoom(event.roomId, {
        players: event.players,
        mode: event.mode,
        matchmakingTimestamp: event.timestamp
      });

    } catch (err) {
      console.error("[CHAT] Error processing room notification:", err);
    }
  });
}