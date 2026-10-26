import assert from "node:assert/strict";
import test from "node:test";
import {
    getDomainEventChannel,
    parseDomainEventMessage,
    validateDomainEvent,
} from "../domain-event-envelope.js";

function validEvent(overrides = {}) {
    return {
        type:       "session-participant-joined",
        version:    1,
        id:         "0b8f5c2e-6a4d-4f43-9a51-2f7f3d1c9e10",
        occurredAt: "2026-10-19T15:00:00.000Z",
        source:     "ethicapp-student",
        payload:    { sessionId: 57, userId: 44, device: "web" },
        ...overrides,
    };
}

test("getDomainEventChannel prefixes kebab-case event types", () => {
    assert.equal(getDomainEventChannel("session-participant-joined"), "ethicapp:events:session-participant-joined");
    assert.throws(() => getDomainEventChannel("SessionJoined"));
});

test("validateDomainEvent accepts a well-formed envelope", () => {
    assert.deepEqual(validateDomainEvent(validEvent()), []);
});

test("validateDomainEvent reports each malformed field", () => {
    const errors = validateDomainEvent(validEvent({
        type:       "Session_Joined",
        version:    0,
        id:         "not-a-uuid",
        occurredAt: "yesterday",
        source:     "",
        payload:    [],
        extra:      true,
    }));

    assert.equal(errors.length, 7);
});

test("validateDomainEvent rejects non-object events", () => {
    assert.deepEqual(validateDomainEvent(null), ["Event must be an object."]);
    assert.deepEqual(validateDomainEvent([]), ["Event must be an object."]);
});

test("parseDomainEventMessage returns the event or the errors", () => {
    const parsed = parseDomainEventMessage(JSON.stringify(validEvent()));
    assert.equal(parsed.event.id, validEvent().id);
    assert.deepEqual(parsed.errors, []);

    assert.deepEqual(parseDomainEventMessage("{not json"), {
        event:  null,
        errors: ["Message is not valid JSON."],
    });

    const invalid = parseDomainEventMessage(JSON.stringify(validEvent({ version: "1" })));
    assert.equal(invalid.event, null);
    assert.equal(invalid.errors.length, 1);
});
