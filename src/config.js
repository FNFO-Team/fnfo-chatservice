module.exports = {
  REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",
  PORT: process.env.PORT || 3001,
  MAX_MSG_LENGTH: 1000,

  // 5 msg/seg por usuario → rate limit simple
  RATE_LIMIT_PER_SECOND: 5
};
