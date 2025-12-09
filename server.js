/**
 * FNFO Chat Service - Server Entry Point
 * Integrado con matchmaking-service y user-profile-service
 */

const express = require("express");
const http = require("http");
const path = require("path");
const Redis = require("ioredis");

const setupSocket = require("./src/sockets");
const config = require("./src/config");
const RoomManager = require("./src/roomManager");
const { verifyToken } = require("./src/auth");
const userService = require("./src/userService");

(async () => {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "public")));

  // Redis client para API REST
  const redis = new Redis(config.REDIS_URL);
  const roomManager = new RoomManager(redis);

  // HEALTH CHECK
  app.get("/health", async (req, res) => {
    try {
      await redis.ping();
      res.json({
        ok: true,
        service: "chat-service",
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      res.status(503).json({
        ok: false,
        error: "Redis not available"
      });
    }
  });

  // GET ROOM MESSAGES (REST API)
  app.get("/rooms/:roomId/messages", async (req, res) => {
    try {
      const { roomId } = req.params;
      const limit = parseInt(req.query.limit) || 100;

      const messages = await roomManager.getLastMessages(roomId, limit);

      res.json({
        ok: true,
        roomId,
        count: messages.length,
        messages: messages.map((m) => m.message)
      });
    } catch (err) {
      res.status(500).json({ ok: false, msg: err.message });
    }
  });

  // GET ROOM INFO
  app.get("/rooms/:roomId", async (req, res) => {
    try {
      const { roomId } = req.params;
      const roomInfo = await roomManager.getRoomInfo(roomId);

      if (!roomInfo) {
        return res.status(404).json({
          ok: false,
          msg: "Room not found"
        });
      }

      res.json({
        ok: true,
        room: roomInfo
      });
    } catch (err) {
      res.status(500).json({ ok: false, msg: err.message });
    }
  });

  // CREATE CHAT ROOM (llamado por matchmaking-service)
  app.post("/rooms", async (req, res) => {
    try {
      const { roomId, players, mode } = req.body;

      if (!roomId) {
        return res.status(400).json({
          ok: false,
          msg: "roomId required"
        });
      }

      const roomInfo = await roomManager.createChatRoom(roomId, {
        players: players || [],
        mode: mode || "unknown"
      });

      res.status(201).json({
        ok: true,
        room: roomInfo
      });
    } catch (err) {
      res.status(500).json({ ok: false, msg: err.message });
    }
  });

  // CLOSE CHAT ROOM (cuando termina la partida)
  app.post("/rooms/:roomId/close", async (req, res) => {
    try {
      const { roomId } = req.params;

      await roomManager.closeChatRoom(roomId);

      res.json({
        ok: true,
        msg: `Room ${roomId} closed`
      });
    } catch (err) {
      res.status(500).json({ ok: false, msg: err.message });
    }
  });

  // GET USER PROFILE (proxy a user-profile-service)
  
  app.get("/users/:oduserId", async (req, res) => {
    try {
      const { oduserId } = req.params;
      const profile = await userService.getProfileByFirebaseUid(oduserId);

      if (!profile) {
        return res.status(404).json({
          ok: false,
          msg: "User not found"
        });
      }

      res.json({
        ok: true,
        user: {
          oduserId: profile.firebaseUid,
          name: profile.name,
          country: profile.country
        }
      });
    } catch (err) {
      res.status(500).json({ ok: false, msg: err.message });
    }
  });

  // START SERVER
  const server = http.createServer(app);

  // Configurar Socket.IO
  await setupSocket(server);

  server.listen(config.PORT, () => {
    console.log("=".repeat(50));
    console.log("💬 FNFO Chat Service");
    console.log("=".repeat(50));
    console.log(`🚀 Server running on port ${config.PORT}`);
    console.log(`📡 REST API: http://localhost:${config.PORT}`);
    console.log(`🔌 WebSocket: ws://localhost:${config.PORT}/socket.io`);
    console.log(`🔗 User Profile Service: ${config.USER_PROFILE_SERVICE_URL}`);
    console.log(`🎮 Matchmaking Service: ${config.MATCHMAKING_SERVICE_URL}`);
    console.log("=".repeat(50));
  });
})();