// The teacher's composing signal (epic #601, #1200) with a fake clock, fake
// timers and a fake channel: when `composing` and `stopped` go out, where to,
// and that nothing about the draft does.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as serverContract from "../../../../../backend/helpers/composing-signal.js";
import {
    CHAT_COMPOSING_EVENT,
    COMPOSING_CLIENT_INTERVAL_MS,
    COMPOSING_IDLE_MS,
    COMPOSING_KIND,
    STOPPED_KIND,
    createComposingSignal,
} from "../composing-signal.js";

// A clock and timers that move only when the test says so.
function createFakeTime(start = 1762959845000) {
    let time = start;
    let nextId = 1;
    const pending = new Map();
    return {
        now:    () => time,
        timers: {
            setTimeout: (callback, delay) => {
                const id = nextId++;
                pending.set(id, { at: time + delay, callback });
                return id;
            },
            clearTimeout: id => pending.delete(id),
        },
        pendingCount: () => pending.size,
        advance(ms) {
            const until = time + ms;
            for (;;) {
                const due = [...pending.entries()]
                    .filter(([, timer]) => timer.at <= until)
                    .sort(([, left], [, right]) => left.at - right.at)[0];
                if (!due) {
                    break;
                }
                const [id, timer] = due;
                pending.delete(id);
                time = timer.at;
                timer.callback();
            }
            time = until;
        },
    };
}

function createFakeChannel({ connected = true } = {}) {
    const emitted = [];
    return {
        connected,
        emitted,
        failing: false,
        isConnected() {
            return this.connected;
        },
        emit(event, payload) {
            if (this.failing) {
                throw new Error("socket closed");
            }
            emitted.push({ event, payload });
        },
    };
}

const TARGET = Object.freeze({ phaseId: 20, questionId: 30, groupId: 9 });

function setUp({ channel = createFakeChannel(), enabled = true } = {}) {
    const time = createFakeTime();
    const signal = createComposingSignal({ timers: time.timers, now: time.now });
    signal.update({ channel, ...TARGET, enabled });
    return { time, signal, channel };
}

function kinds(channel) {
    return channel.emitted.map(({ payload }) => payload.kind);
}

describe("the teacher's composing signal", () => {
    it("keeps the contract's names and client timing of the server", () => {
        assert.equal(CHAT_COMPOSING_EVENT, serverContract.CHAT_COMPOSING_EVENT);
        assert.equal(COMPOSING_KIND, serverContract.COMPOSING_KIND);
        assert.equal(STOPPED_KIND, serverContract.STOPPED_KIND);
        assert.equal(COMPOSING_CLIENT_INTERVAL_MS, serverContract.COMPOSING_CLIENT_INTERVAL_MS);
        assert.equal(COMPOSING_IDLE_MS, serverContract.COMPOSING_IDLE_MS);
    });

    it("sends composing on the first edit, with the target's ids and the kind only", () => {
        const { signal, channel } = setUp();
        signal.edited();
        assert.deepEqual(channel.emitted, [{
            event:   "chatComposing",
            payload: { phaseId: 20, questionId: 30, groupId: 9, kind: "composing" },
        }]);
        assert.deepEqual(Object.keys(channel.emitted[0].payload), serverContract.CHAT_COMPOSING_PAYLOAD_FIELDS);
    });

    it("sends composing again at most every 5 s while edits continue", () => {
        const { time, signal, channel } = setUp();
        signal.edited();
        for (let step = 0; step < 12; step += 1) {
            time.advance(1000);
            signal.edited();
        }
        // Edits at 0 s and every second up to 12 s: composing at 0, 5 and 10 s.
        assert.deepEqual(kinds(channel), ["composing", "composing", "composing"]);
    });

    it("sends at most 13 signals a minute however fast the teacher types", () => {
        const { time, signal, channel } = setUp();
        for (let step = 0; step < 600; step += 1) {
            signal.edited();
            time.advance(100);
        }
        assert.ok(channel.emitted.length <= 13, `${channel.emitted.length} signals`);
    });

    it("sends stopped 8 s after the last edit, once", () => {
        const { time, signal, channel } = setUp();
        signal.edited();
        time.advance(3000);
        signal.edited();
        time.advance(7999);
        assert.deepEqual(kinds(channel), ["composing"]);
        time.advance(1);
        assert.deepEqual(kinds(channel), ["composing", "stopped"]);
        time.advance(60000);
        assert.deepEqual(kinds(channel), ["composing", "stopped"]);
        assert.equal(time.pendingCount(), 0);
    });

    it("starts over with composing on the next edit after a stopped", () => {
        const { time, signal, channel } = setUp();
        signal.edited();
        time.advance(COMPOSING_IDLE_MS);
        time.advance(1000);
        signal.edited();
        assert.deepEqual(kinds(channel), ["composing", "stopped", "composing"]);
    });

    it("sends stopped on stop(), for a blur or a submit, only after a composing", () => {
        const { signal, channel } = setUp();
        signal.stop();
        assert.deepEqual(channel.emitted, []);

        signal.edited();
        signal.stop();
        signal.stop();
        assert.deepEqual(kinds(channel), ["composing", "stopped"]);
    });

    it("sends stopped to the previous group when the group or the question changes", () => {
        const { signal, channel } = setUp();
        signal.edited();
        signal.update({ channel, ...TARGET, groupId: 10, enabled: true });
        signal.edited();
        signal.update({ channel, ...TARGET, groupId: 10, questionId: 31, enabled: true });

        assert.deepEqual(channel.emitted.map(({ payload }) => [payload.groupId, payload.questionId, payload.kind]), [
            [9, 30, "composing"],
            [9, 30, "stopped"],
            [10, 30, "composing"],
            [10, 30, "stopped"],
        ]);
    });

    it("sends nothing on an update with the same target", () => {
        const { signal, channel } = setUp();
        signal.edited();
        signal.update({ channel, ...TARGET, enabled: true });
        assert.deepEqual(kinds(channel), ["composing"]);
    });

    it("sends stopped when the chat stops accepting messages, and nothing while it is closed", () => {
        const { signal, channel } = setUp();
        signal.edited();
        signal.update({ channel, ...TARGET, enabled: false });
        signal.edited();
        assert.deepEqual(kinds(channel), ["composing", "stopped"]);
    });

    it("sends nothing for an incomplete target or without a channel", () => {
        const channel = createFakeChannel();
        const time = createFakeTime();
        const signal = createComposingSignal({ timers: time.timers, now: time.now });

        signal.update({ channel, ...TARGET, questionId: undefined, enabled: true });
        signal.edited();
        signal.update({ channel, ...TARGET, groupId: 0, enabled: true });
        signal.edited();
        signal.update({ channel: null, ...TARGET, enabled: true });
        signal.edited();

        assert.deepEqual(channel.emitted, []);
    });

    it("sends nothing while the socket is disconnected, and composing once it is back", () => {
        const channel = createFakeChannel({ connected: false });
        const { signal } = setUp({ channel });
        signal.edited();
        assert.deepEqual(channel.emitted, []);

        channel.connected = true;
        signal.edited();
        assert.deepEqual(kinds(channel), ["composing"]);
    });

    it("ignores an emit that throws, and keeps working afterwards", () => {
        const channel = createFakeChannel();
        const { signal } = setUp({ channel });
        channel.failing = true;
        assert.doesNotThrow(() => signal.edited());
        channel.failing = false;
        signal.edited();
        assert.deepEqual(kinds(channel), ["composing"]);
    });

    it("sends a pending stopped on dispose(), cancels its timer and then does nothing", () => {
        const { time, signal, channel } = setUp();
        signal.edited();
        signal.dispose();
        assert.deepEqual(kinds(channel), ["composing", "stopped"]);
        assert.equal(time.pendingCount(), 0);

        signal.update({ channel, ...TARGET, enabled: true });
        signal.edited();
        signal.stop();
        signal.dispose();
        time.advance(60000);
        assert.deepEqual(kinds(channel), ["composing", "stopped"]);
    });
});
