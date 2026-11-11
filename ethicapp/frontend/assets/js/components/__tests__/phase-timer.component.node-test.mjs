// The phase clock and "+1 min" in the activity dashboard's bar (#1115, epic
// #1105): ticks outside AngularJS on fake timers, redraws only when what it
// shows changes, follows `onPhaseClock` and the tab's visibility, announces
// the last minute and the end of the time, extends once per click with the
// kept deadline, tells the teacher why a refusal added nothing, and stops on
// destroy. The template and its text in both locales.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import phaseTimerComponent, {
    PhaseTimerController,
    TOAST_CONTAINER,
} from "../phase-timer.component.js";

const SESSION_ID = 10;
const LOCAL_NOW = Date.parse("2026-11-11T12:00:00.000Z");

const readAsset = path => readFileSync(new URL(path, import.meta.url), "utf8");
const template = readAsset("../../../static/views/teacher/fragments/phase-timer.template.html");
const barTemplate = readAsset("../../../static/views/teacher/fragments/activity-bar.template.html");
const locale = name => JSON.parse(readAsset(`../../../locales/${name}.json`));

// Timers and a local clock the test moves by hand.
function fakeTime() {
    let nowMs = LOCAL_NOW;
    let nextId = 1;
    const timers = new Map();
    const listeners = new Map();
    const document = {
        visibilityState:     "visible",
        addEventListener:    (name, fn) => listeners.set(name, fn),
        removeEventListener: (name, fn) => {
            if (listeners.get(name) === fn) {
                listeners.delete(name);
            }
        },
    };
    const $window = {
        document,
        setTimeout(fn, delay) {
            const id = nextId++;
            timers.set(id, { fn, at: nowMs + delay });
            return id;
        },
        clearTimeout(id) {
            timers.delete(id);
        },
    };
    return {
        $window,
        document,
        listeners,
        timers,
        now: () => nowMs,
        // Moves the clock and runs the timers that fall due, in order.
        advance(ms) {
            const end = nowMs + ms;
            for (;;) {
                const due = [...timers.entries()].filter(([, timer]) => timer.at <= end)
                    .sort(([, a], [, b]) => a.at - b.at)[0];
                if (!due) {
                    break;
                }
                const [id, timer] = due;
                timers.delete(id);
                nowMs = Math.max(nowMs, timer.at);
                timer.fn();
            }
            nowMs = end;
        },
        // Moves the clock without running timers, as a background tab.
        jump(ms) {
            nowMs += ms;
        },
    };
}

function keptClock(time, msLeft, overrides = {}) {
    return {
        sessionId:   SESSION_ID,
        timeMode:    "soft",
        finished:    false,
        phaseId:     41,
        phaseNumber: 2,
        startedAt:   "2026-11-11T11:50:00.000Z",
        endsAt:      new Date(time.now() + msLeft).toISOString(),
        isLastPhase: false,
        serverNow:   new Date(time.now()).toISOString(),
        offsetMs:    0,
        receivedAt:  time.now(),
        ...overrides,
    };
}

function fakeActivityState(clock) {
    const listeners = {};
    const extendCalls = [];
    const state = {
        clock,
        extendCalls,
        extendResult:  { ok: true, code: null },
        extendHold:    null,
        getPhaseClock: id => (Number(id) === SESSION_ID ? state.clock : null),
        registerListener(name, fn) {
            (listeners[name] ||= []).push(fn);
        },
        unregisterListener(name, fn) {
            listeners[name] = (listeners[name] || []).filter(listener => listener !== fn);
        },
        listenerCount: name => (listeners[name] || []).length,
        // A kept clock changed, as ActivityStateService notifies it.
        emitClock(next) {
            state.clock = next;
            (listeners.onPhaseClock || []).forEach(fn => fn(next));
        },
        async extendPhaseClock(sessionId, phaseId, expectedEndsAt) {
            extendCalls.push({ sessionId, phaseId, expectedEndsAt });
            if (state.extendHold) {
                await state.extendHold;
            }
            const { result, clock: next } = typeof state.extendResult === "function"
                ? state.extendResult()
                : { result: state.extendResult };
            if (next) {
                state.emitClock(next);
            }
            return result;
        },
    };
    return state;
}

// A digest is counted for each $applyAsync, and run at once.
function fakeScope() {
    const scope = {
        digests: 0,
        $applyAsync(fn) {
            scope.digests += 1;
            fn?.();
        },
    };
    return scope;
}

function fakeElement() {
    const digits = { textContent: "", writes: 0 };
    let text = "";
    Object.defineProperty(digits, "textContent", {
        get: () => text,
        set: (value) => {
            text = value;
            digits.writes += 1;
        },
    });
    return {
        digits,
        $element: [{
            querySelector: selector => (selector === ".phase-timer-digits" ? digits : null),
        }],
    };
}

function createTimer({ msLeft = 10 * 60 * 1000, overrides = {}, isFinished = false } = {}) {
    const time = fakeTime();
    const activityState = fakeActivityState(keptClock(time, msLeft, overrides));
    const $scope = fakeScope();
    const { digits, $element } = fakeElement();
    const toasts = [];
    const toast = { create: options => toasts.push(options) };
    const $translate = {
        instant: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
    };
    const vm = new PhaseTimerController($scope, $element, time.$window, $translate,
        activityState, toast, time.now);
    vm.sessionId = SESSION_ID;
    vm.isFinished = isFinished;
    vm.$onChanges({});
    vm.$onInit();
    vm.$postLink();
    return { vm, time, activityState, $scope, digits, toasts };
}

describe("phase timer: ticking", () => {
    it("counts down from the kept clock, one write per second", () => {
        const { vm, time, digits } = createTimer({ msLeft: 12 * 60 * 1000 + 34 * 1000 });
        assert.equal(vm.view.state, "running");
        assert.equal(digits.textContent, "12:34");

        const writes = digits.writes;
        // Each tick lands just after the second changes.
        time.advance(1100);
        assert.equal(digits.textContent, "12:33");
        time.advance(3000);
        assert.equal(digits.textContent, "12:30");
        assert.equal(digits.writes, writes + 4);
    });

    it("runs no digest per tick, only when what the bar shows changes", () => {
        const { vm, time, $scope } = createTimer({ msLeft: 2 * 60 * 1000 + 30 * 1000 });
        const digests = $scope.digests;
        time.advance(20 * 1000);
        assert.equal($scope.digests, digests, "twenty ticks, no digest");

        // 03:00 → 02:00 left for screen readers is the next minute.
        time.advance(15 * 1000);
        assert.equal($scope.digests, digests + 1);
        assert.deepEqual(vm.view.spoken,
            { key: "phase_timer_sr_remaining_other", params: { count: 2 } });
    });

    it("warns in the last minute, then counts negative time in soft mode", () => {
        const { vm, time, digits } = createTimer({ msLeft: 61 * 1000 });
        time.advance(1100);
        assert.equal(vm.view.state, "warning");
        assert.equal(digits.textContent, "01:00");

        time.advance(60 * 1000 + 135 * 1000);
        assert.equal(vm.view.state, "overtime");
        assert.equal(digits.textContent, "−02:15");
    });

    it("shows that a hard activity moves on, without digits", () => {
        const { vm, time, digits } = createTimer({ msLeft: 3000, overrides: { timeMode: "hard" } });
        assert.equal(vm.view.state, "warning");
        assert.equal(vm.view.automatic, true);
        assert.equal(vm.view.nextPhaseNumber, 3);
        time.advance(3100);
        assert.equal(vm.view.state, "advancing");
        assert.equal(digits.textContent, "");
        assert.equal(vm.isExtendDisabled(), true);
    });

    it("shows that time is up on a hard last phase, and lets it be extended", () => {
        const { vm, time } = createTimer({
            msLeft:    1000,
            overrides: { timeMode: "hard", isLastPhase: true },
        });
        time.advance(2000);
        assert.equal(vm.view.state, "time-up");
        assert.equal(vm.isExtendDisabled(), false);
    });

    it("is right after the tab spent five minutes in the background", () => {
        const { vm, time, digits } = createTimer({ msLeft: 10 * 60 * 1000 });
        time.jump(5 * 60 * 1000 + 300);
        time.document.visibilityState = "visible";
        time.listeners.get("visibilitychange")();
        assert.equal(digits.textContent, "05:00");
        assert.equal(vm.view.state, "running");
    });

    it("does nothing when the tab is hidden", () => {
        const { time, digits } = createTimer({ msLeft: 10 * 60 * 1000 });
        time.jump(5000);
        time.document.visibilityState = "hidden";
        const writes = digits.writes;
        time.listeners.get("visibilitychange")();
        assert.equal(digits.writes, writes);
    });

    it("shows no clock without a deadline, and stops ticking", () => {
        const { vm, time, digits } = createTimer({ overrides: { endsAt: null } });
        assert.equal(vm.view.state, "none");
        assert.equal(digits.textContent, "");
        assert.equal(time.timers.size, 0);
    });

    it("hides as soon as the dashboard knows the activity finished", () => {
        const { vm, time } = createTimer();
        vm.isFinished = true;
        vm.$onChanges({ isFinished: {} });
        assert.equal(vm.view.state, "none");
        assert.equal(time.timers.size, 0);
    });
});

describe("phase timer: clock events", () => {
    it("follows a new deadline from onPhaseClock at once", () => {
        const { vm, time, activityState, digits } = createTimer({ msLeft: 30 * 1000 });
        assert.equal(vm.view.state, "warning");

        // "+1 min" from another dashboard.
        activityState.emitClock(keptClock(time, 90 * 1000));
        assert.equal(vm.view.state, "running");
        assert.equal(digits.textContent, "01:30");
        assert.equal(time.timers.size, 1, "one tick scheduled, not two");
    });

    it("ignores another activity's clock", () => {
        const { vm, time, digits } = createTimer({ msLeft: 30 * 1000 });
        const writes = digits.writes;
        vm.phaseClockHandler({ ...keptClock(time, 90 * 1000), sessionId: 99 });
        assert.equal(digits.writes, writes);
        assert.equal(vm.view.state, "warning");
    });

    it("hides once the activity finished", () => {
        const { vm, time, activityState } = createTimer();
        activityState.emitClock(keptClock(time, 0, {
            finished: true, phaseId: null, phaseNumber: null, endsAt: null, isLastPhase: null,
        }));
        assert.equal(vm.view.state, "none");
        assert.equal(time.timers.size, 0);
    });

    it("stops ticking and listening on destroy", () => {
        const { vm, time, activityState } = createTimer();
        assert.equal(activityState.listenerCount("onPhaseClock"), 1);
        assert.ok(time.listeners.has("visibilitychange"));
        vm.$onDestroy();
        assert.equal(activityState.listenerCount("onPhaseClock"), 0);
        assert.equal(time.listeners.has("visibilitychange"), false);
        assert.equal(time.timers.size, 0);
    });
});

describe("phase timer: announcements", () => {
    it("announces the last minute and the end of the time, once each", () => {
        const { vm, time } = createTimer({ msLeft: 62 * 1000 });
        time.advance(1000);
        assert.equal(vm.announcement, "");
        time.advance(1500);
        assert.equal(vm.announcement, "phase_timer_announce_one_minute");

        time.advance(30 * 1000);
        assert.equal(vm.announcement, "phase_timer_announce_one_minute", "nothing new meanwhile");

        time.advance(31 * 1000);
        assert.equal(vm.announcement, "phase_timer_announce_time_up");
    });

    it("announces nothing for a clock already in its last minute or past it", () => {
        const { vm, time } = createTimer({ msLeft: -10 * 1000 });
        time.advance(5000);
        assert.equal(vm.announcement, "");
    });

    it("announces only the end of the time after the background", () => {
        const { vm, time } = createTimer({ msLeft: 5 * 60 * 1000 });
        time.jump(6 * 60 * 1000);
        time.listeners.get("visibilitychange")();
        time.advance(200);
        assert.equal(vm.announcement, "phase_timer_announce_time_up");
    });

    it("starts over with a new deadline", () => {
        const { vm, time, activityState } = createTimer({ msLeft: 70 * 1000 });
        // A new phase whose clock is already under a minute: no threshold
        // was crossed for it.
        activityState.emitClock(keptClock(time, 50 * 1000, { phaseId: 42, phaseNumber: 3 }));
        time.advance(200);
        assert.equal(vm.announcement, "");
    });
});

describe("phase timer: +1 min", () => {
    it("extends with the kept deadline and announces the minute added", async () => {
        const { vm, time, activityState, digits, toasts } = createTimer({ msLeft: 30 * 1000 });
        const expectedEndsAt = activityState.clock.endsAt;
        activityState.extendResult = () => ({
            result: { ok: true, code: null },
            clock:  keptClock(time, 90 * 1000),
        });

        await vm.extend();
        assert.deepEqual(activityState.extendCalls,
            [{ sessionId: SESSION_ID, phaseId: 41, expectedEndsAt }]);
        assert.equal(digits.textContent, "01:30");
        assert.equal(vm.extending, false);
        assert.equal(toasts.length, 0);
        time.advance(200);
        assert.equal(vm.announcement, "phase_timer_announce_extended");
    });

    it("sends one request while one is in flight", async () => {
        const { vm, activityState } = createTimer({ msLeft: 30 * 1000 });
        let release;
        activityState.extendHold = new Promise((resolve) => {
            release = resolve;
        });

        const first = vm.extend();
        assert.equal(vm.extending, true);
        assert.equal(vm.isExtendDisabled(), true);
        await vm.extend();
        await vm.extend();
        assert.equal(activityState.extendCalls.length, 1);

        release();
        await first;
        assert.equal(vm.extending, false);
        assert.equal(vm.isExtendDisabled(), false);
    });

    for (const [code, key] of [
        ["DEADLINE_CHANGED", "phase_timer_extend_deadline_changed"],
        ["PHASE_NOT_CURRENT", "phase_timer_extend_phase_changed"],
        ["ACTIVITY_FINISHED", "phase_timer_extend_finished"],
        ["NO_DEADLINE", "phase_timer_extend_no_deadline"],
        ["DEADLINE_PASSED", "phase_timer_extend_deadline_passed"],
    ]) {
        it(`tells the teacher why ${code} added nothing`, async () => {
            const { vm, activityState, toasts } = createTimer({ msLeft: 30 * 1000 });
            activityState.extendResult = { ok: false, code };

            await vm.extend();
            assert.equal(toasts.length, 1);
            assert.equal(toasts[0].containerClass, TOAST_CONTAINER);
            assert.equal(toasts[0].type, "warning");
            assert.equal(toasts[0].message, key);
            assert.equal(vm.announcement, "");
            assert.equal(vm.extending, false);
        });
    }

    it("shows the clock the refusal carries", async () => {
        const { vm, time, activityState, digits } = createTimer({ msLeft: 30 * 1000 });
        // Another dashboard added the minute first: the 409's clock.
        activityState.extendResult = () => ({
            result: { ok: false, code: "DEADLINE_CHANGED" },
            clock:  keptClock(time, 89 * 1000),
        });
        await vm.extend();
        assert.equal(digits.textContent, "01:29");
        assert.equal(vm.view.state, "running");
    });

    it("asks to try again when the last phase's time just ran out", async () => {
        const { vm, activityState, toasts } = createTimer({
            msLeft:    500,
            overrides: { timeMode: "hard", isLastPhase: true },
        });
        activityState.extendResult = { ok: false, code: "DEADLINE_PASSED" };
        await vm.extend();
        assert.equal(toasts[0].message, "phase_timer_extend_retry");
    });

    it("tells the teacher a failure, as a danger toast", async () => {
        const { vm, activityState, toasts } = createTimer({ msLeft: 30 * 1000 });
        activityState.extendResult = { ok: false, code: null };
        await vm.extend();
        assert.equal(toasts[0].type, "danger");
        assert.equal(toasts[0].message, "phase_timer_extend_failed");
    });

    it("does not extend while the activity moves on, or without a clock", async () => {
        const advancing = createTimer({ msLeft: -1000, overrides: { timeMode: "hard" } });
        await advancing.vm.extend();
        assert.equal(advancing.activityState.extendCalls.length, 0);

        const none = createTimer({ overrides: { endsAt: null } });
        await none.vm.extend();
        assert.equal(none.activityState.extendCalls.length, 0);
    });

    it("extends after 00:00 in soft mode", async () => {
        const { vm, activityState } = createTimer({ msLeft: -135 * 1000 });
        await vm.extend();
        assert.equal(activityState.extendCalls.length, 1);
    });
});

describe("phase timer template", () => {
    it("binds the activity and whether it finished one way", () => {
        assert.deepEqual(phaseTimerComponent.bindings, { sessionId: "<", isFinished: "<" });
        assert.equal(phaseTimerComponent.templateUrl,
            "/assets/static/views/teacher/fragments/phase-timer.template.html");
        assert.equal(phaseTimerComponent.controller.at(-1), PhaseTimerController);
    });

    it("sits right after the phase chip in the bar", () => {
        const phaseChip = barTemplate.lastIndexOf("activity_bar_no_phase");
        const timer = barTemplate.indexOf("<phase-timer");
        const code = barTemplate.indexOf("activity-bar-code");
        assert.ok(phaseChip < timer && timer < code);
        assert.match(barTemplate, /session-id="\$ctrl\.sessionId"/);
    });

    it("hides the digits from screen readers and keeps a polite live region", () => {
        assert.match(template,
            /<span class="phase-timer-text" aria-hidden="true">[\s\S]*phase-timer-digits/);
        assert.match(template,
            /<span class="sr-only" role="status" aria-live="polite">\{\{ \$ctrl\.announcement/);
        // The digits stay in the page, so the ticks can write them.
        assert.match(template, /<span class="phase-timer-digits" ng-show=/);
    });

    it("names the button by what it does and disables it without losing focus", () => {
        assert.match(template, /class="btn btn-default btn-sm phase-timer-extend"/);
        assert.match(template, /aria-label="\{\{ 'phase_timer_extend_label' \| translate \}\}"/);
        assert.match(template,
            /aria-disabled="\{\{ \$ctrl\.isExtendDisabled\(\) \? 'true' : 'false' \}\}"/);
        assert.doesNotMatch(template, /ng-disabled/);
    });

    it("has every key it uses in both locales", () => {
        const keys = new Set([...template.matchAll(/'([a-z0-9_]+)'\s*\|\s*translate/g)]
            .map(match => match[1]));
        for (const key of [
            "phase_timer_sr_remaining_one", "phase_timer_sr_remaining_other",
            "phase_timer_sr_overtime_one", "phase_timer_sr_overtime_other",
            "phase_timer_sr_time_up", "phase_timer_sr_advancing",
            "phase_timer_announce_one_minute", "phase_timer_announce_time_up",
            "phase_timer_announce_extended", "phase_timer_extend_deadline_changed",
            "phase_timer_extend_phase_changed", "phase_timer_extend_finished",
            "phase_timer_extend_no_deadline", "phase_timer_extend_deadline_passed",
            "phase_timer_extend_failed", "phase_timer_extend_retry",
        ]) {
            keys.add(key);
        }
        assert.ok(keys.has("phase_timer_extend_label"));
        for (const name of ["es_CL", "en_US"]) {
            const catalog = locale(name);
            for (const key of keys) {
                assert.equal(typeof catalog[key], "string", `${name} has ${key}`);
            }
        }
    });

    it("labels the button +1 min in both locales", () => {
        for (const name of ["es_CL", "en_US"]) {
            const catalog = locale(name);
            assert.equal(catalog.phase_timer_extend_button, "+1 min");
        }
    });
});
