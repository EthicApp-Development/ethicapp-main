// The time card of the launch wizard's second step (#1109, epic #1105):
// when it shows, what it says about the phases, its options, and the
// `timeMode` field it sends.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
    DEFAULT_LAUNCH_TIME_MODE,
    LAUNCH_TIME_MODE_OPTIONS,
    TIME_MODE,
    launchTimeModeField,
    launchTimeModeView,
} from "../launch-time-mode.js";
import { plannedDesignDuration } from "../phase-duration.js";

function locale(name) {
    const url = new URL(`../../../locales/${name}.json`, import.meta.url);
    return JSON.parse(readFileSync(url, "utf8"));
}

describe("launchTimeModeView", () => {
    it("is hidden for a design without durations", () => {
        for (const planned of [
            plannedDesignDuration([{}, {}]),
            plannedDesignDuration([]),
            null,
            undefined,
            { totalMinutes: "x", timedPhaseCount: -1, phaseCount: 2 },
        ]) {
            assert.deepEqual(launchTimeModeView(planned),
                { shown: false, summary: null, hasUntimedPhases: false }, JSON.stringify(planned));
        }
    });

    it("counts the phases with a duration and says the others run untimed", () => {
        const planned = plannedDesignDuration([
            { durationMinutes: 10 }, { durationMinutes: 20 }, {}, { durationMinutes: 15 },
        ]);
        const summary = {
            key:    "launch_wizard_time_phases_some",
            params: { minutes: 45, timed: 3, total: 4 },
        };
        assert.deepEqual(launchTimeModeView(planned),
            { shown: true, summary, hasUntimedPhases: true });
    });

    it("says when every phase has a duration", () => {
        const view = launchTimeModeView(
            plannedDesignDuration([{ durationMinutes: 5 }, { durationMinutes: 5 }]));
        assert.equal(view.summary.key, "launch_wizard_time_phases_all");
        assert.equal(view.hasUntimedPhases, false);
    });

    it("speaks of the phase for a design of one phase", () => {
        const view = launchTimeModeView(plannedDesignDuration([{ durationMinutes: 30 }]));
        assert.deepEqual(view.summary, {
            key:    "launch_wizard_time_phases_single",
            params: { minutes: 30, timed: 1, total: 1 },
        });
    });
});

describe("launch time mode options", () => {
    it("offers Soft (preselected), Hard and No clock, in that order", () => {
        assert.equal(DEFAULT_LAUNCH_TIME_MODE, TIME_MODE.SOFT);
        assert.deepEqual(LAUNCH_TIME_MODE_OPTIONS.map(option => option.value),
            ["soft", "hard", "none"]);
    });

    it("has every key of the card in both locales", () => {
        const keys = [
            "launch_wizard_time_title",
            "launch_wizard_time_phases_some",
            "launch_wizard_time_phases_all",
            "launch_wizard_time_phases_single",
            "launch_wizard_time_untimed_note",
            ...LAUNCH_TIME_MODE_OPTIONS.flatMap(option => [option.labelKey, option.helpKey]),
        ];
        for (const name of ["es_CL", "en_US"]) {
            const catalog = locale(name);
            for (const key of keys) {
                assert.equal(typeof catalog[key], "string", `${name} ${key}`);
            }
        }
    });

    it("speaks of participants, not students", () => {
        assert.match(locale("es_CL").launch_wizard_time_hard_help, /participantes/u);
        assert.match(locale("en_US").launch_wizard_time_hard_help, /participant/u);
        for (const name of ["es_CL", "en_US"]) {
            const texts = Object.entries(locale(name))
                .filter(([key]) => key.startsWith("launch_wizard_time_"))
                .map(([, text]) => text)
                .join(" ");
            assert.doesNotMatch(texts, /estudiante|student/iu, name);
        }
    });
});

describe("launchTimeModeField", () => {
    const SHOWN = { shown: true };

    it("sends the chosen mode when the card is shown", () => {
        assert.equal(launchTimeModeField(SHOWN, "soft"), "soft");
        assert.equal(launchTimeModeField(SHOWN, "hard"), "hard");
        assert.equal(launchTimeModeField(SHOWN, "none"), "none");
    });

    it("falls back to Soft for an unknown choice", () => {
        assert.equal(launchTimeModeField(SHOWN, "fast"), "soft");
        assert.equal(launchTimeModeField(SHOWN, undefined), "soft");
    });

    it("sends nothing when the card is hidden", () => {
        for (const view of [{ shown: false }, null, undefined]) {
            assert.equal(launchTimeModeField(view, "hard"), undefined);
        }
    });
});
