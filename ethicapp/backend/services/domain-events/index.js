import { createClient } from "redis";
import * as config from "../../config/database.config.js";
import * as rpg2 from "../../db/rest-pg-2.js";
import { resolveApplicationRedisUrl } from "../../db/application-redis.js";
import * as socketConfig from "../../config/socket.config.js";
import { DomainEventSubscriber } from "./domain-event-subscriber.js";
import {
    createSessionParticipantJoinedHandler,
} from "./handlers/session-participant-joined.handler.js";

async function loadParticipant(userId) {
    const rows = await rpg2.execSQL({
        dbcon:     config.dbconnString,
        sql:       "SELECT name, role, mail FROM users WHERE id = $1",
        sqlParams: [rpg2.param("plain", userId)],
    });

    return rows[0] ?? null;
}

function notifyTeachers(sessionId, participant) {
    socketConfig.teacherNotifications?.studentJoined(sessionId, participant);
}

/**
 * Connects a dedicated Redis subscriber and starts dispatching domain events.
 * Connection problems are logged; node-redis reconnects and restores
 * subscriptions on its own.
 * @returns {Promise<DomainEventSubscriber>}
 */
export async function startDomainEventSubscriber({ env = process.env, logger = console } = {}) {
    const redisClient = createClient({ url: resolveApplicationRedisUrl(env, logger) });

    redisClient.on("ready", () => {
        logger.log("[domain-events] Subscriber connected to Redis.");
    });

    redisClient.on("error", (error) => {
        logger.error("[domain-events] Subscriber Redis error:", error);
    });

    await redisClient.connect();

    const subscriber = new DomainEventSubscriber({
        redisClient,
        logger,
        handlers: [
            createSessionParticipantJoinedHandler({ loadParticipant, notifyTeachers, logger }),
        ],
    });

    await subscriber.start();
    logger.log(`[domain-events] Subscribed to ${subscriber.channels.join(", ")}.`);

    return subscriber;
}
