// The phase clock and "+1 min" in the activity dashboard's bar (#1115, epic
// #1105). It shows the clock that ActivityStateService keeps for the
// activity (#1116) and follows it through `onPhaseClock`.
//
// The count ticks outside AngularJS: each tick works the time left out from
// the deadline and the server's offset (helpers/phase-timer.js) and writes
// the digits straight into their element, so no digest runs every second.
// The bar is redrawn ($applyAsync) only when what it shows changes: the
// state, the deadline, or the whole minutes a screen reader is told. A tick
// lands just after each second changes; the timer also ticks when the
// clock changes and when the tab becomes visible again, where background
// timers may have been held back.
//
// The digits are hidden from screen readers. They read the time left in
// whole minutes from a hidden text, and a polite live region announces
// only the last minute, the end of the time and a minute added here.
//
// "+1 min" sends the kept clock's deadline as `expectedEndsAt`, so the
// server adds one minute once however many dashboards ask. While a request
// runs the button is disabled (aria-disabled, so it keeps the focus) and
// further clicks do nothing. A refusal keeps the clock in its answer and
// tells the teacher why in the dashboard's toast.

import { isSessionEvent } from "../helpers/phase-clock-state.js";
import {
    crossedThreshold,
    extendRefusalMessageKey,
    formatClock,
    nextTickDelayMs,
    timerView,
    WARNING_MS,
} from "../helpers/phase-timer.js";

// The dashboard's toast, fixed under the bar (activity.view.html).
export const TOAST_CONTAINER = "activity-dashboard-toast-container";
const TOAST_TIMEOUT_MS = 8000;
const ANNOUNCEMENT_DELAY_MS = 100;

const ANNOUNCEMENT_KEYS = Object.freeze({
    [WARNING_MS]: "phase_timer_announce_one_minute",
    0:            "phase_timer_announce_time_up",
});

// `now` is for tests; AngularJS injects the others.
export function PhaseTimerController($scope, $element, $window, $translate, ActivityStateService,
    toast, now = () => Date.now()) {
    const vm = this;

    vm.view = timerView(null, { localNowMs: now() });
    vm.extending = false;
    vm.announcement = "";

    let timer = null;
    let announcementTimer = null;
    let shownKey = vm.view.key;
    let shownDigits = null;
    // The previous reading of the current deadline, for the announcements.
    let lastDeadline = null;
    let lastRemainingMs = null;

    const translate = (key, params) => (typeof $translate?.instant === "function"
        ? $translate.instant(key, params)
        : key);

    const keptClock = () => ActivityStateService.getPhaseClock(vm.sessionId);

    function clearTimer() {
        if (timer !== null) {
            $window.clearTimeout(timer);
            timer = null;
        }
    }

    function writeDigits(text) {
        const digits = $element?.[0]?.querySelector?.(".phase-timer-digits");
        if (!digits) {
            shownDigits = null;
            return;
        }
        if (text !== shownDigits || digits.textContent !== text) {
            digits.textContent = text;
            shownDigits = text;
        }
    }

    // The live region is emptied first and filled a moment later, so the
    // same words are announced again.
    function announce(key) {
        $window.clearTimeout(announcementTimer);
        $scope.$applyAsync(() => {
            vm.announcement = "";
        });
        announcementTimer = $window.setTimeout(() => {
            announcementTimer = null;
            $scope.$applyAsync(() => {
                vm.announcement = translate(key);
            });
        }, ANNOUNCEMENT_DELAY_MS);
    }

    // Reads the clock, writes the digits, redraws the bar when what it shows
    // changed, announces a threshold, and schedules the next tick.
    vm.tick = function() {
        clearTimer();
        const view = timerView(keptClock(),
            { localNowMs: now(), isFinished: vm.isFinished === true });

        writeDigits(view.showDigits ? formatClock(view.remainingMs) : "");

        if (view.deadline !== lastDeadline) {
            lastDeadline = view.deadline;
            lastRemainingMs = null;
        }
        const crossed = crossedThreshold(lastRemainingMs, view.remainingMs);
        lastRemainingMs = view.remainingMs;

        if (view.key !== shownKey) {
            shownKey = view.key;
            $scope.$applyAsync(() => {
                vm.view = view;
            });
        }
        if (crossed !== null) {
            announce(ANNOUNCEMENT_KEYS[crossed]);
        }

        if (view.state !== "none") {
            timer = $window.setTimeout(vm.tick, nextTickDelayMs(view.remainingMs));
        }
    };

    vm.phaseClockHandler = function(phaseClock) {
        if (isSessionEvent(phaseClock, vm.sessionId)) {
            vm.tick();
        }
    };

    vm.visibilityHandler = function() {
        if ($window.document?.visibilityState !== "hidden") {
            vm.tick();
        }
    };

    vm.$onInit = function() {
        ActivityStateService.registerListener("onPhaseClock", vm.phaseClockHandler);
        $window.document?.addEventListener?.("visibilitychange", vm.visibilityHandler);
        vm.tick();
    };

    // The template is in: write the digits now rather than at the next tick.
    vm.$postLink = function() {
        vm.tick();
    };

    // Another activity, or the dashboard knows the activity finished.
    vm.$onChanges = function() {
        vm.tick();
    };

    vm.$onDestroy = function() {
        clearTimer();
        $window.clearTimeout(announcementTimer);
        announcementTimer = null;
        ActivityStateService.unregisterListener("onPhaseClock", vm.phaseClockHandler);
        $window.document?.removeEventListener?.("visibilitychange", vm.visibilityHandler);
    };

    vm.isExtendDisabled = function() {
        return vm.extending || !vm.view.canExtend;
    };

    // "+1 min". Resolves once the answer is handled.
    vm.extend = async function() {
        const clock = keptClock();
        if (vm.extending || !vm.view.canExtend || !clock?.phaseId || !clock.endsAt) {
            return;
        }

        vm.extending = true;
        let outcome = null;
        try {
            outcome = await ActivityStateService.extendPhaseClock(vm.sessionId, clock.phaseId,
                clock.endsAt);
        } finally {
            vm.extending = false;
            $scope.$applyAsync();
            vm.tick();
        }

        if (outcome?.ok) {
            announce("phase_timer_announce_extended");
            return;
        }
        if (typeof toast?.create === "function") {
            toast.create({
                containerClass: TOAST_CONTAINER,
                type:           outcome?.code ? "warning" : "danger",
                dismissible:    true,
                timeout:        TOAST_TIMEOUT_MS,
                message:        translate(extendRefusalMessageKey(outcome?.code,
                    { isLastPhase: clock.isLastPhase === true })),
            });
        }
    };
}

export default {
    bindings: {
        sessionId:  "<",
        isFinished: "<",
    },
    controller: ["$scope", "$element", "$window", "$translate", "ActivityStateService", "toast",
        PhaseTimerController],
    templateUrl: "/assets/static/views/teacher/fragments/phase-timer.template.html",
};
