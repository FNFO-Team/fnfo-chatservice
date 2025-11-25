const express = require("express");
const http = require("http");
const path = require("path");
const Redis = require("ioredis");

const setupSocket = require("./src/sockets");
const config = require("./src/config");
const RoomManager = require("./src/roomManager");

(async () => {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "public")));

  // Redis global para API REST (1 sola conexión)
  const redis = new Redis(config.REDIS_URL);

  // health check
  app.get("/health", (req, res) => res.json({ ok: true }));

  // obtener últimos mensajes sin socket.io
  app.get("/rooms/:roomId/messages", async (req, res) => {
    try {
      const rm = new RoomManager(redis);
      const last = await rm.getLastMessages(req.params.roomId, 100);
      return res.json({
        ok: true,
        messages: last.map(m => m.message)
      });
    } catch (err) {
      return res.status(500).json({ ok: false, msg: err.message });
    }
  });

  const server = http.createServer(app);

  // conectar socket.io
  await setupSocket(server);

  server.listen(config.PORT, () =>
    console.log(`Chat Service listening on port ${config.PORT}`)
  );
})();
