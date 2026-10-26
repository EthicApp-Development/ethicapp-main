import assert from "node:assert/strict";
import test from "node:test";
import { DomainEventSubscriber } from "../domain-event-subscriber.js";

const CHANNEL = "ethicapp:events:session-participant-joined";

function createFakeRedisClient() {
    const listeners = new Map();
    return {
        listeners,
        unsubscribed: [],
        async subscribe(channel, listener) {
            listeners.set(channel, listener);
        },
        async unsubscribe(channels) {
            this.unsubscribed.push(...channels);
        },
        async deliver(channel, message) {
            return listeners.get(channel)(message, channel);
        },
    };
}

function createSilentLogger() {
    const entries = { warn: [], error: [], debug: [] };
    return {
        entries,
        warn:  (...args) => entries.warn.push(args.join(" ")),
        error: (...args) => entries.error.push(args.join(" ")),
        debug: (...args) => entries.debug.push(args.join(" ")),
        log:   () => {},
    };
}

function eventMessage(overrides = {}) {
    return JSON.stringify({
        type:       "session-participant-joined",
        version:    1,
        id:         "0b8f5c2e-6a4d-4f43-9a51-2f7f3d1c9e10",
        occurredAt: "2026-10-19T15:00:00.000Z",
        source:     "ethicapp-student",
        payload:    { sessionId: 57, userId: 44, device: "web" },
        ...overrides,
    });
}

function createSubscriber({ handle = async () => {}, deduplicationCapacity } = {}) {
    const redisClient = createFakeRedisClient();
    const logger = createSilentLogger();
    const handled = [];
    const subscriber = new DomainEventSubscriber({
        redisClient,
        logger,
        deduplicationCapacity,
        handlers: [{
            type:    "session-participant-joined",
            version: 1,
            async handle(event) {
                handled.push(event);
                await handle(event);
            },
        }],
    });

    return { subscriber, redisClient, logger, handled };
}

test("start subscribes once per handled event type and stop unsubscribes", async () => {
    const { subscriber, redisClient } = createSubscriber();

    await subscriber.start();
    assert.deepEqual(Array.from(redisClient.listeners.keys()), [CHANNEL]);

    await subscriber.stop();
    assert.deepEqual(redisClient.unsubscribed, [CHANNEL]);
});

test("valid events are dispatched to the handler for their type and version", async () => {
    const { subscriber, redisClient, handled } = createSubscriber();
    await subscriber.start();

    assert.equal(await redisClient.deliver(CHANNEL, eventMessage()), true);
    assert.equal(handled.length, 1);
    assert.deepEqual(handled[0].payload, { sessionId: 57, userId: 44, device: "web" });
});

test("invalid JSON and invalid envelopes are logged and ignored", async () => {
    const { subscriber, logger, handled } = createSubscriber();

    assert.equal(await subscriber.handleMessage("{not json", CHANNEL), false);
    assert.equal(await subscriber.handleMessage(eventMessage({ id: "nope" }), CHANNEL), false);
    assert.equal(handled.length, 0);
    assert.equal(logger.entries.warn.length, 2);
});

test("unknown versions and unknown types are logged and ignored", async () => {
    const { subscriber, logger, handled } = createSubscriber();

    assert.equal(await subscriber.handleMessage(eventMessage({ version: 2 }), CHANNEL), false);
    assert.equal(
        await subscriber.handleMessage(eventMessage({ type: "other-event" }), "ethicapp:events:other-event"),
        false,
    );
    assert.equal(handled.length, 0);
    assert.equal(logger.entries.warn.length, 2);
});

test("events whose type does not match the channel are ignored", async () => {
    const { subscriber, handled } = createSubscriber();

    assert.equal(await subscriber.handleMessage(eventMessage(), "ethicapp:events:other-event"), false);
    assert.equal(handled.length, 0);
});

test("duplicate event ids are processed once", async () => {
    const { subscriber, handled } = createSubscriber();

    await subscriber.handleMessage(eventMessage(), CHANNEL);
    assert.equal(await subscriber.handleMessage(eventMessage(), CHANNEL), false);
    assert.equal(handled.length, 1);
});

test("deduplication memory is bounded", async () => {
    const { subscriber, handled } = createSubscriber({ deduplicationCapacity: 1 });
    const firstId = "0b8f5c2e-6a4d-4f43-9a51-2f7f3d1c9e10";
    const secondId = "1c9f6d3f-7b5e-4a54-8b62-3a8a4e2d0f21";

    await subscriber.handleMessage(eventMessage({ id: firstId }), CHANNEL);
    await subscriber.handleMessage(eventMessage({ id: secondId }), CHANNEL);
    await subscriber.handleMessage(eventMessage({ id: firstId }), CHANNEL);

    assert.equal(handled.length, 3);
});

test("handler failures are logged and do not throw", async () => {
    const { subscriber, logger } = createSubscriber({
        handle: async () => {
            throw new Error("boom");
        },
    });

    assert.equal(await subscriber.handleMessage(eventMessage(), CHANNEL), false);
    assert.equal(logger.entries.error.length, 1);
});

test("duplicate handler registrations are rejected", () => {
    const handler = { type: "session-participant-joined", version: 1, handle: async () => {} };

    assert.throws(() => new DomainEventSubscriber({
        redisClient: createFakeRedisClient(),
        handlers:    [handler, handler],
    }));
});
