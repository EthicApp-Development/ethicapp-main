// Participants' composing signals on their way to AI services (epic #601,
// #655): coalesced per participant, group and question, with a fake clock,
// and dispatched through the ephemeral hook only to the phase's services.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    createParticipantActivityCoalescer,
    createParticipantActivityForwarder,
} from "../participant-activity-helper.js";

const WRITER = Object.freeze({ userId: 44, groupId: 9, questionId: 30 });

function composing(participant = WRITER) {
    return { ...participant, kind: "composing" };
}

function stopped(participant = WRITER) {
    return { ...participant, kind: "stopped" };
}

describe("createParticipantActivityCoalescer", () => {
    it("forwards the first composing, then at most one every 12 s", () => {
        let clock = 1000;
        const coalescer = createParticipantActivityCoalescer({ now: () => clock });

        const forwardedAt = [];
        // The client sends `composing` every 5 s while edits continue, and a
        // tampered client may send one every second.
        for (let second = 0; second <= 40; second += 1) {
            clock = 1000 + second * 1000;
            if (coalescer.shouldForward(composing())) {
                forwardedAt.push(second);
            }
        }
        assert.deepEqual(forwardedAt, [0, 12, 24, 36]);
    });

    it("forwards a stopped once, and only after a forwarded composing", () => {
        let clock = 0;
        const coalescer = createParticipantActivityCoalescer({ now: () => clock });

        assert.equal(coalescer.shouldForward(stopped()), false, "no composing yet");
        assert.equal(coalescer.shouldForward(composing()), true);
        clock = 3000;
        assert.equal(coalescer.shouldForward(composing()), false);
        assert.equal(coalescer.shouldForward(stopped()), true);
        assert.equal(coalescer.shouldForward(stopped()), false, "once");

        clock = 4000;
        assert.equal(coalescer.shouldForward(composing()), true, "a composing after a stop is a first one");
    });

    it("keeps participants, groups and questions apart", () => {
        const coalescer = createParticipantActivityCoalescer({ now: () => 0 });
        assert.equal(coalescer.shouldForward(composing()), true);
        assert.equal(coalescer.shouldForward(composing({ ...WRITER, userId: 45 })), true);
        assert.equal(coalescer.shouldForward(composing({ ...WRITER, groupId: 10 })), true);
        assert.equal(coalescer.shouldForward(composing({ ...WRITER, questionId: 31 })), true);
        assert.equal(coalescer.shouldForward(composing()), false);
    });

    it("lets an entry expire 30 s after its last forwarded composing", () => {
        let clock = 0;
        const coalescer = createParticipantActivityCoalescer({ now: () => clock });
        coalescer.shouldForward(composing());

        clock = 30000;
        assert.equal(coalescer.shouldForward(stopped()), false, "the services no longer count the writer");

        coalescer.shouldForward(composing());
        clock = 61000;
        coalescer.shouldForward(composing({ ...WRITER, userId: 45 }));
        assert.equal(coalescer.size(), 1, "expired entries are swept");
    });

    it("forgets a participant", () => {
        const coalescer = createParticipantActivityCoalescer({ now: () => 0 });
        coalescer.shouldForward(composing());
        coalescer.forget(WRITER);
        assert.equal(coalescer.size(), 0);
        assert.equal(coalescer.shouldForward(stopped()), false);
        assert.equal(coalescer.shouldForward(composing()), true);
    });
});

const SIGNAL = Object.freeze({
    kind:       "composing",
    sessionId:  57,
    phaseId:    20,
    questionId: 30,
    groupId:    9,
    userId:     44,
    receivedAt: 1762959845000,
});

function makeForwarder({ enabledServiceIds = ["polyadic-agent"], dispatchError = null, loadError = null } = {}) {
    let clock = 0;
    const dispatches = [];
    const phaseReads = [];
    const errors = [];
    const forwarder = createParticipantActivityForwarder({
        coalescer:         createParticipantActivityCoalescer({ now: () => clock }),
        loadPhaseServices: async (phaseId) => {
            phaseReads.push(phaseId);
            if (loadError) {
                throw loadError;
            }
            return { enabledServiceIds, configurations: {} };
        },
        dispatchEphemeralHook: async (...args) => {
            dispatches.push(args);
            if (dispatchError) {
                throw dispatchError;
            }
            return [];
        },
        logger: { error: (...args) => errors.push(args) },
    });
    return {
        forwarder,
        dispatches,
        phaseReads,
        errors,
        advance: (ms) => {
            clock += ms;
        },
    };
}

describe("createParticipantActivityForwarder", () => {
    it("dispatches participant-activity with the contract's fields to the phase's services", async () => {
        const { forwarder, dispatches, phaseReads } = makeForwarder({ enabledServiceIds: ["a", "b"] });

        await forwarder.forward(SIGNAL);

        assert.deepEqual(phaseReads, [20]);
        assert.deepEqual(dispatches, [[
            "participant-activity",
            {
                kind:       "composing",
                sessionId:  57,
                phaseId:    20,
                questionId: 30,
                groupId:    9,
                userId:     44,
                receivedAt: 1762959845000,
            },
            { enabledServiceIds: ["a", "b"] },
        ]]);
    });

    it("dispatches nothing to a phase without services or with the session's services off", async () => {
        const { forwarder, dispatches, phaseReads } = makeForwarder({ enabledServiceIds: [] });
        await forwarder.forward(SIGNAL);
        assert.deepEqual(phaseReads, [20]);
        assert.equal(dispatches.length, 0);
    });

    it("coalesces before reading the phase's services", async () => {
        const { forwarder, dispatches, phaseReads, advance } = makeForwarder();

        await forwarder.forward(SIGNAL);
        advance(5000);
        await forwarder.forward(SIGNAL);
        advance(5000);
        await forwarder.forward(SIGNAL);
        advance(2000);
        await forwarder.forward(SIGNAL);
        await forwarder.forward({ ...SIGNAL, kind: "stopped" });
        await forwarder.forward({ ...SIGNAL, kind: "stopped" });

        assert.deepEqual(dispatches.map(([, context]) => context.kind), ["composing", "composing", "stopped"]);
        assert.equal(phaseReads.length, 3);
    });

    it("takes the coalescing decisions in call order, before any await", async () => {
        const { forwarder, dispatches } = makeForwarder();
        await Promise.all([
            forwarder.forward(SIGNAL),
            forwarder.forward(SIGNAL),
            forwarder.forward({ ...SIGNAL, kind: "stopped" }),
        ]);
        assert.deepEqual(dispatches.map(([, context]) => context.kind), ["composing", "stopped"]);
    });

    it("logs a failed read or dispatch with ids only, and never rejects", async () => {
        const failure = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
        for (const options of [{ loadError: failure }, { dispatchError: failure }]) {
            const { forwarder, errors } = makeForwarder(options);
            await forwarder.forward(SIGNAL);
            assert.equal(errors.length, 1);
            const [, details] = errors[0];
            assert.deepEqual(Object.keys(details).sort(), ["error", "groupId", "phaseId", "sessionId"]);
            assert.equal(details.error.code, "ECONNREFUSED");
        }
    });

    it("forgets a participant, so their next composing is a first one", async () => {
        const { forwarder, dispatches } = makeForwarder();
        await forwarder.forward(SIGNAL);
        forwarder.forget(WRITER);
        await forwarder.forward(SIGNAL);
        assert.equal(dispatches.length, 2);
    });
});
