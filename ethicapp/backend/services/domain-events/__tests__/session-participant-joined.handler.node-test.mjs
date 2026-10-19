import assert from "node:assert/strict";
import test from "node:test";
import {
    createSessionParticipantJoinedHandler,
    validateSessionParticipantJoinedPayload,
} from "../handlers/session-participant-joined.handler.js";

const silentLogger = { warn: () => {}, error: () => {}, log: () => {} };

function joinedEvent(payload) {
    return {
        type:       "session-participant-joined",
        version:    1,
        id:         "0b8f5c2e-6a4d-4f43-9a51-2f7f3d1c9e10",
        occurredAt: "2026-10-19T15:00:00.000Z",
        source:     "ethicapp-student",
        payload,
    };
}

test("validateSessionParticipantJoinedPayload accepts the v1 payload", () => {
    assert.deepEqual(validateSessionParticipantJoinedPayload({ sessionId: 57, userId: 44, device: "web" }), []);
    assert.deepEqual(validateSessionParticipantJoinedPayload({ sessionId: 57, userId: 44, device: null }), []);
});

test("validateSessionParticipantJoinedPayload rejects personal data and malformed ids", () => {
    const errors = validateSessionParticipantJoinedPayload({
        sessionId: "57",
        userId:    0,
        device:    "x".repeat(65),
        mail:      "student@example.com",
    });

    assert.equal(errors.length, 4);
});

test("handler notifies teachers with the legacy join payload", async () => {
    const notifications = [];
    const handler = createSessionParticipantJoinedHandler({
        loadParticipant: async userId => (userId === 44
            ? { name: "Student", role: "A", mail: "student@example.com" }
            : null),
        notifyTeachers: (sessionId, participant) => notifications.push({ sessionId, participant }),
        logger:         silentLogger,
    });

    await handler.handle(joinedEvent({ sessionId: 57, userId: 44, device: "web" }));

    assert.deepEqual(notifications, [{
        sessionId:   57,
        participant: { id: 44, name: "Student", device: "web", role: "A", mail: "student@example.com" },
    }]);
});

test("handler skips invalid payloads and unknown users without notifying", async () => {
    const notifications = [];
    let lookups = 0;
    const handler = createSessionParticipantJoinedHandler({
        loadParticipant: async () => {
            lookups += 1;
            return null;
        },
        notifyTeachers: (...args) => notifications.push(args),
        logger:         silentLogger,
    });

    await handler.handle(joinedEvent({ sessionId: 57 }));
    assert.equal(lookups, 0);

    await handler.handle(joinedEvent({ sessionId: 57, userId: 999, device: "web" }));
    assert.equal(lookups, 1);
    assert.equal(notifications.length, 0);
});
