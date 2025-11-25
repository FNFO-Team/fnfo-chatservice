const { v4: uuidv4 } = require("uuid");

class RoomManager {
  constructor(redisClient) {
    this.redis = redisClient;
  }

  streamKey(roomId) {
    return `stream:chat:${roomId}`;
  }

  // ----------------------------------------
  // SAVE MESSAGE IN REDIS STREAM
  // ----------------------------------------
  async saveMessage(roomId, messageObj) {
    const key = this.streamKey(roomId);

    await this.redis.xadd(
      key,
      "*",
      "message",
      JSON.stringify(messageObj)
    );
  }

  // ----------------------------------------
  // GET LAST N MESSAGES (CHRONOLOGICAL)
  // ----------------------------------------
  async getLastMessages(roomId, count = 50) {
    const key = this.streamKey(roomId);

    try {
      // XREVRANGE es la forma más eficiente
      const entries = await this.redis.xrevrange(
        key,
        "+",
        "-",
        "COUNT",
        count
      );

      return entries
        .map(([id, fields]) => {
          const obj = {};

          for (let i = 0; i < fields.length; i += 2) {
            obj[fields[i]] = fields[i + 1];
          }

          if (obj.message) {
            try {
              obj.message = JSON.parse(obj.message);
            } catch (_) {}
          }

          return { id, ...obj };
        })
        .reverse(); // devolver en orden cronológico
    } catch (err) {
      console.error("getLastMessages fallback:", err);

      // fallback XRANGE para compatibilidad
      const all = await this.redis.xrange(key, "-", "+");
      return all.slice(-count).map(([id, fields]) => {
        const obj = {};
        for (let i = 0; i < fields.length; i += 2) {
          obj[fields[i]] = fields[i + 1];
        }
        if (obj.message) {
          try {
            obj.message = JSON.parse(obj.message);
          } catch (_) {}
        }
        return { id, ...obj };
      });
    }
  }

  // ----------------------------------------
  // RATE LIMIT: 5 mensajes por segundo por usuario
  // ----------------------------------------
  async checkRateLimit(userKey) {
    const key = `rate:${userKey}`;

    const count = await this.redis.incr(key);

    if (count === 1) {
      await this.redis.expire(key, 1); // ventana de 1 segundo
    }

    return count <= 5; // máximo 5 mensajes por segundo
  }
}

module.exports = RoomManager;
