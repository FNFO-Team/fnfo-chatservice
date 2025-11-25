// src/sockets.js

const { createAdapter } = require("@socket.io/redis-adapter");
const Redis = require("ioredis");
const RoomManager = require("./roomManager");
const auth = require("./auth");
const config = require("./config");

module.exports = async function setupSocket(server) {
  const io = require("socket.io")(server, {
    cors: { origin: "*" }
  });

  // --- Redis clients ---
  const pubClient = new Redis(config.REDIS_URL); // NO connect()
  const subClient = new Redis(config.REDIS_URL); // NO connect()

  // Adapter multi instancia
  io.adapter(createAdapter(pubClient, subClient));

  const roomManager = new RoomManager(pubClient);

  // --- AUTH MIDDLEWARE ---
  io.use((socket, next) => {
    const check = auth.validateConnectionPayload(socket.handshake);
    if (!check.ok) return next(new Error(check.reason));

    socket.data.user = check.user;
    next();
  });

  // --- MAIN CONNECTION ---
  io.on("connection", (socket) => {
    const username = socket.data.user.username;
    console.log("[SOCKET] Connected:", username, socket.id);

    // JOIN ROOM
    socket.on("room:join", async (payload, cb) => {
      try {
        const { roomId } = payload || {};
        if (!roomId) return cb?.({ ok: false, msg: "roomId required" });

        socket.join(roomId);

        const last = await roomManager.getLastMessages(roomId, 50);
        cb?.({ ok: true, last: last.map((m) => m.message) });

        socket.to(roomId).emit("system", {
          text: `${username} se unió`
        });
      } catch (err) {
        console.error(err);
        cb?.({ ok: false, msg: err.message });
      }
    });

    // LEAVE
    socket.on("room:leave", (payload) => {
      const { roomId } = payload || {};
      if (roomId) {
        socket.leave(roomId);
        socket.to(roomId).emit("system", {
          text: `${username} salió`
        });
      }
    });

    // CHAT MESSAGE
    socket.on("chat:message", async (payload, cb) => {
      try {
        const { roomId, text } = payload || {};
        if (!roomId || !text) {
          return cb?.({ ok: false, msg: "roomId + text required" });
        }

        const clean = String(text).slice(0, config.MAX_MSG_LENGTH);
        if (!clean.trim()) return;

        const allowed = await roomManager.checkRateLimit(username);
        if (!allowed) {
          return cb?.({ ok: false, msg: "rate limit" });
        }

        const msg = {
          from: username,
          text: clean,
          timestamp: Date.now()
        };

        await roomManager.saveMessage(roomId, msg);

        io.to(roomId).emit("chat:message", msg);

        cb?.({ ok: true });
      } catch (err) {
        console.error("chat:message error:", err);
        cb?.({ ok: false, msg: err.message });
      }
    });

    // DISCONNECT
    socket.on("disconnect", () => {
      console.log("[SOCKET] Disconnected:", username, socket.id);
    });
  });

  return io;
};
