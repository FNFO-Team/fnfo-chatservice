/**
 * Room Manager - Gestión de salas de chat
 * Integrado con matchmaking-service
 */

const config = require("./config");

class RoomManager {
  constructor(redisClient) {
    this.redis = redisClient;
  }

  // KEYS

  streamKey(roomId) {
    return `stream:chat:${roomId}`;
  }

  roomInfoKey(roomId) {
    return `room:info:${roomId}`;
  }

  userRoomsKey(oduserId) {
    return `user:rooms:${oduserId}`;
  }

  // ROOM MANAGEMENT

  /**
   * Registra una sala de chat (llamado cuando matchmaking crea una sala)
   */
  async createChatRoom(roomId, metadata = {}) {
    const key = this.roomInfoKey(roomId);
    
    const roomInfo = {
      roomId,
      createdAt: Date.now(),
      status: "active",
      players: JSON.stringify(metadata.players || []),
      mode: metadata.mode || "unknown",
      ...metadata
    };

    await this.redis.hset(key, roomInfo);
    await this.redis.expire(key, 60 * 60 * 4); // 4 horas de expiración

    console.log(`[ROOM] Chat creado para sala: ${roomId}`);
    return roomInfo;
  }

  /**
   * Obtiene información de una sala
   */
  async getRoomInfo(roomId) {
    const key = this.roomInfoKey(roomId);
    const info = await this.redis.hgetall(key);
    
    if (!info || Object.keys(info).length === 0) {
      return null;
    }

    if (info.players) {
      try {
        info.players = JSON.parse(info.players);
      } catch (_) {
        info.players = [];
      }
    }

    return info;
  }

  /**
   * Verifica si un usuario puede unirse a una sala
   * (debe ser parte de la sala de matchmaking)
   */
  async canUserJoinRoom(roomId, oduserId) {
    // En modo desarrollo, permitir cualquier usuario
    if (process.env.NODE_ENV !== "production") {
      return { allowed: true };
    }

    const roomInfo = await this.getRoomInfo(roomId);
    
    // Si no hay info de la sala, intentar obtenerla del matchmaking
    if (!roomInfo) {
      const matchmakingRoom = await this.fetchRoomFromMatchmaking(roomId);
      
      if (!matchmakingRoom) {
        return { allowed: false, reason: "room not found" };
      }

      // Crear la sala de chat si viene del matchmaking
      await this.createChatRoom(roomId, {
        players: matchmakingRoom.players,
        mode: matchmakingRoom.mode
      });

      // Verificar si el usuario está en la sala
      if (!matchmakingRoom.players.includes(oduserId)) {
        return { allowed: false, reason: "not a player in this room" };
      }

      return { allowed: true };
    }

    // Verificar si el usuario está en la lista de jugadores
    if (roomInfo.players && !roomInfo.players.includes(oduserId)) {
      return { allowed: false, reason: "not a player in this room" };
    }

    return { allowed: true };
  }

  /**
   * Obtiene información de sala desde matchmaking-service
   */
  async fetchRoomFromMatchmaking(roomId) {
    try {
      const response = await fetch(
        `${config.MATCHMAKING_SERVICE_URL}/rooms/${roomId}`
      );

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error(`[ROOM] Error fetching from matchmaking:`, error.message);
      return null;
    }
  }

  /**
   * Registra que un usuario está en una sala
   */
  async addUserToRoom(roomId, oduserId) {
    const key = this.userRoomsKey(oduserId);
    await this.redis.sadd(key, roomId);
    await this.redis.expire(key, 60 * 60 * 4);
  }

  /**
   * Remueve un usuario de una sala
   */
  async removeUserFromRoom(roomId, oduserId) {
    const key = this.userRoomsKey(oduserId);
    await this.redis.srem(key, roomId);
  }

  /**
   * Obtiene las salas de un usuario
   */
  async getUserRooms(oduserId) {
    const key = this.userRoomsKey(oduserId);
    return await this.redis.smembers(key);
  }

  /**
   * Cierra una sala de chat (cuando termina la partida)
   */
  async closeChatRoom(roomId) {
    const infoKey = this.roomInfoKey(roomId);
    
    // Marcar como cerrada
    await this.redis.hset(infoKey, "status", "closed");
    await this.redis.hset(infoKey, "closedAt", Date.now().toString());

    console.log(`[ROOM] Chat cerrado para sala: ${roomId}`);
  }

  // MESSAGES

  /**
   * Guarda un mensaje en el stream de Redis
   */
  async saveMessage(roomId, messageObj) {
    const key = this.streamKey(roomId);

    await this.redis.xadd(
      key,
      "*",
      "message",
      JSON.stringify(messageObj)
    );

    // Expiración del stream (4 horas)
    await this.redis.expire(key, 60 * 60 * 4);
  }

  /**
   * Obtiene los últimos N mensajes de una sala
   */
  async getLastMessages(roomId, count = 50) {
    const key = this.streamKey(roomId);

    try {
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
        .reverse();
    } catch (err) {
      console.error("[ROOM] getLastMessages error:", err.message);
      
      // Fallback
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

  // RATE LIMITING

  /**
   * Verifica rate limit de un usuario
   */
  async checkRateLimit(oduserId) {
    const key = `rate:chat:${oduserId}`;
    const count = await this.redis.incr(key);

    if (count === 1) {
      await this.redis.expire(key, 1);
    }

    return count <= config.RATE_LIMIT_PER_SECOND;
  }
}

module.exports = RoomManager;