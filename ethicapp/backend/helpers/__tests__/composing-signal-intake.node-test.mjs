// Receiving a composing signal (epic #601, #655): the per-socket rate limit,
// the payload check and the group notice, shared by the student and teacher
// sockets.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    chatComposingNotice,
    createComposingRateLimit,
    parseChatComposingPayload,
} from "../composing-signal-intake.js";

const VALID = Object.freeze({ phaseId: 20, questionId: 30, groupId: 9, kind: "composing" });

describe("createComposingRateLimit", () => {
    it("allows 20 signals per minute and drops the 21st", () => {
        let clock = 0;
        const rateLimit = createComposingRateLimit({ now: () => clock });

        for (let index = 0; index < 20; index += 1) {
            clock = index * 1000;
            assert.equal(rateLimit.tryAcquire(), true, `signal ${index + 1}`);
        }
        clock = 59999;
        assert.equal(rateLimit.tryAcquire(), false, "the 21st within a minute");

        clock = 60000;
        assert.equal(rateLimit.tryAcquire(), true, "the first signal left the window");
    });

    it("keeps each socket's limit apart", () => {
        const clock = () => 0;
        const first = createComposingRateLimit({ now: clock });
        const second = createComposingRateLimit({ now: clock });
        for (let index = 0; index < 20; index += 1) {
            first.tryAcquire();
        }
        assert.equal(first.tryAcquire(), false);
        assert.equal(second.tryAcquire(), true);
    });
});

describe("parseChatComposingPayload", () => {
    it("accepts the contract's four fields", () => {
        const signal = parseChatComposingPayload({ ...VALID });
        assert.deepEqual(signal, VALID);
        assert.ok(Object.isFrozen(signal));
        assert.deepEqual(parseChatComposingPayload({ ...VALID, kind: "stopped" }).kind, "stopped");
    });

    it("drops a payload with draft content, its length or any other field", () => {
        for (const extra of [
            { content: "draft" },
            { text: "draft" },
            { length: 5 },
            { userId: 45 },
            { sentAt: 1 },
            { content: undefined },
        ]) {
            assert.equal(parseChatComposingPayload({ ...VALID, ...extra }), null, Object.keys(extra)[0]);
        }
    });

    it("drops a payload with a missing field", () => {
        for (const field of Object.keys(VALID)) {
            const payload = { ...VALID };
            delete payload[field];
            assert.equal(parseChatComposingPayload(payload), null, field);
        }
    });

    it("drops ids that are not positive integers and unknown kinds", () => {
        for (const field of ["phaseId", "questionId", "groupId"]) {
            for (const value of [0, -1, 1.5, "9", null, Number.NaN, 2 ** 53]) {
                assert.equal(parseChatComposingPayload({ ...VALID, [field]: value }), null,
                    `${field} = ${String(value)}`);
            }
        }
        for (const kind of ["typing", "", null, "COMPOSING"]) {
            assert.equal(parseChatComposingPayload({ ...VALID, kind }), null, String(kind));
        }
    });

    it("drops anything that is not a plain object", () => {
        for (const payload of [null, undefined, "composing", 9, [VALID], new Map(), Object.create({ ...VALID })]) {
            assert.equal(parseChatComposingPayload(payload), null);
        }
    });
});

describe("chatComposingNotice", () => {
    it("carries the signal's group, question and kind with the writer's label, and nothing else", () => {
        const notice = chatComposingNotice(
            { userId: 44, role: "A", name: "Fox" },
            { ...VALID, kind: "stopped" }
        );
        assert.deepEqual(notice, {
            groupId:    9,
            questionId: 30,
            userId:     44,
            role:       "A",
            name:       "Fox",
            kind:       "stopped",
        });
    });
});
