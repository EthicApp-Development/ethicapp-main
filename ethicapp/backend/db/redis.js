import Redis from "ioredis";

const cacheUrl = process.env.REDIS_CACHE_URL || process.env.REDIS_URL;

// Initialize Redis client
const redisClient = cacheUrl
    ? new Redis(cacheUrl, { keyPrefix: "ethicapp" })
    : new Redis({
        host:      process.env.REDIS_CACHE_HOST || process.env.REDIS_HOST || "127.0.0.1",
        port:      process.env.REDIS_CACHE_PORT || process.env.REDIS_PORT || 6379,
        keyPrefix: "ethicapp"
    });

// Handle events to monitor the state of the Redis client
redisClient.on("connect", () => console.log("Connected to Redis"));
redisClient.on("error", (err) => console.error("Redis connection error:", err));

export default redisClient;
