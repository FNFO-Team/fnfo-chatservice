module.exports = {
  // Redis
  REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",
  
  // Server
  PORT: process.env.PORT || 3001,
  
  // Chat limits
  MAX_MSG_LENGTH: 1000,
  RATE_LIMIT_PER_SECOND: 5,
  HISTORY_LIMIT: 50,
  
  // User Profile Service URL
  USER_PROFILE_SERVICE_URL: process.env.USER_PROFILE_SERVICE_URL || "http://localhost:8080/api/profiles",
  
  // Firebase (para verificar tokens)
  GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  
  // Matchmaking Service URL (para validar salas)
  MATCHMAKING_SERVICE_URL: process.env.MATCHMAKING_SERVICE_URL || "http://localhost:8082/api/matchmaking",
  
  CHANNELS: {
    ROOM_NOTIFICATIONS: "room.notifications",
    CHAT_EVENTS: "chat.events"
  }
};