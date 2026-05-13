import Redis from "ioredis";

const cacheUrl = process.env.REDIS_CACHE_URL;

// Initialize Redis client
const redisClient = cacheUrl
    ? new Redis(cacheUrl, { keyPrefix: "ethicapp" })
    : new Redis({
        host:      process.env.REDIS_CACHE_HOST || "redis-cache",
        port:      process.env.REDIS_CACHE_PORT || 6379,
        keyPrefix: "ethicapp"
    });

// Handle events to monitor the state of the Redis client
redisClient.on("connect", () => console.log("Connected to Redis"));
redisClient.on("error", (err) => console.error("Redis connection error:", err));

export default redisClient;
