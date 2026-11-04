import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
    ACTIVITY_TABS,
    ACTIVITY_TAB_ARCHIVED,
    ACTIVITY_TAB_FINISHED,
    ACTIVITY_TAB_ONGOING,
    LIST_STATUS_FINISHED,
    LIST_STATUS_IN_PROGRESS,
    LIST_STATUS_NOT_STARTED,
    activityListStatus,
    activityListStatusLabel,
    activityTab,
} from "../activity-list-status.js";

const NOT_STARTED = Object.freeze({
    status: 1, currentPhase: null, phaseCount: 3, archived: false,
});
const IN_PROGRESS = Object.freeze({
    status: 2, currentPhase: { number: 2, mode: "team" }, phaseCount: 3, archived: false,
});
const FINISHED = Object.freeze({ status: 3, currentPhase: null, phaseCount: 3, archived: false });

describe("activityListStatus (#1049)", () => {
    it("says not started for an activity launched with no phase started", () => {
        assert.deepEqual(activityListStatus(NOT_STARTED),
            { id: LIST_STATUS_NOT_STARTED, phase: null });
    });

    it("gives the phase number, the phase count and the mode of an activity in progress", () => {
        assert.deepEqual(activityListStatus(IN_PROGRESS), {
            id:    LIST_STATUS_IN_PROGRESS,
            phase: { number: 2, total: 3, mode: "team" },
        });
    });

    it("reads any mode other than team as individual", () => {
        for (const mode of ["individual", "other", undefined]) {
            const status = activityListStatus({
                ...IN_PROGRESS, currentPhase: { number: 1, mode },
            });
            assert.equal(status.phase.mode, "individual", String(mode));
        }
    });

    it("never gives fewer phases than the one running", () => {
        for (const phaseCount of [1, 0, undefined, "x"]) {
            const status = activityListStatus({ ...IN_PROGRESS, phaseCount });
            assert.equal(status.phase.total, 2, String(phaseCount));
        }
    });

    it("takes the status by name as well as by code", () => {
        assert.equal(activityListStatus({ ...NOT_STARTED, status: "initiated" }).id,
            LIST_STATUS_NOT_STARTED);
        assert.equal(activityListStatus({ ...IN_PROGRESS, status: "in_progress" }).id,
            LIST_STATUS_IN_PROGRESS);
        assert.equal(activityListStatus({ ...FINISHED, status: "3" }).id, LIST_STATUS_FINISHED);
    });

    it("says finished whatever the phase, once the teacher ends it", () => {
        assert.deepEqual(activityListStatus({ ...IN_PROGRESS, status: 3 }),
            { id: LIST_STATUS_FINISHED, phase: null });
    });

    it("says in progress without a phase when the status says so but no phase is known", () => {
        assert.deepEqual(activityListStatus({ status: 2, currentPhase: null, phaseCount: 3 }),
            { id: LIST_STATUS_IN_PROGRESS, phase: null });
    });

    it("says in progress when a phase runs, whatever the status says", () => {
        for (const status of [null, 1]) {
            assert.equal(activityListStatus({ ...IN_PROGRESS, status }).id,
                LIST_STATUS_IN_PROGRESS, String(status));
        }
    });

    it("says not started for a row a launch added, with no list fields", () => {
        assert.equal(activityListStatus({ status: 1 }).id, LIST_STATUS_NOT_STARTED);
        assert.equal(activityListStatus({}).id, LIST_STATUS_NOT_STARTED);
        assert.equal(activityListStatus(undefined).id, LIST_STATUS_NOT_STARTED);
    });

    it("ignores a current phase without a valid number", () => {
        for (const number of [0, -1, 1.5, null, undefined, "x"]) {
            const status = activityListStatus({
                status: 1, currentPhase: { number, mode: "team" },
            });
            assert.equal(status.id, LIST_STATUS_NOT_STARTED, String(number));
        }
    });
});

describe("activityTab (#1049)", () => {
    it("puts activities not finished and not archived in En curso, started or not", () => {
        assert.equal(activityTab(NOT_STARTED), ACTIVITY_TAB_ONGOING);
        assert.equal(activityTab(IN_PROGRESS), ACTIVITY_TAB_ONGOING);
        assert.equal(activityTab({}), ACTIVITY_TAB_ONGOING);
    });

    it("puts finished activities that are not archived in Terminadas", () => {
        assert.equal(activityTab(FINISHED), ACTIVITY_TAB_FINISHED);
    });

    it("puts archived activities in Archivadas, whatever their status", () => {
        for (const activity of [FINISHED, IN_PROGRESS, NOT_STARTED]) {
            assert.equal(activityTab({ ...activity, archived: true }), ACTIVITY_TAB_ARCHIVED);
        }
    });

    it("names the three tabs", () => {
        assert.deepEqual(ACTIVITY_TABS, ["ongoing", "finished", "archived"]);
    });
});

describe("activityListStatusLabel (#1049)", () => {
    it("says Sin iniciar for an activity not started", () => {
        assert.deepEqual(activityListStatusLabel(activityListStatus(NOT_STARTED)),
            { key: "activities_status_not_started", params: {}, modeKey: null });
    });

    it("says the phase as the dashboard's bar, with the mode's key to translate", () => {
        assert.deepEqual(activityListStatusLabel(activityListStatus(IN_PROGRESS)), {
            key:     "activity_bar_phase_label",
            params:  { number: 2, total: 3 },
            modeKey: "activity_bar_phase_mode_team",
        });

        const individual = activityListStatus({ ...IN_PROGRESS, currentPhase: { number: 1 } });
        assert.equal(activityListStatusLabel(individual).modeKey,
            "activity_bar_phase_mode_individual");
    });

    it("says En curso for an activity in progress whose phase is not known", () => {
        assert.deepEqual(activityListStatusLabel({ id: LIST_STATUS_IN_PROGRESS, phase: null }),
            { key: "in_progress", params: {}, modeKey: null });
    });

    it("says Finalizada for a finished activity", () => {
        assert.deepEqual(activityListStatusLabel(activityListStatus(FINISHED)),
            { key: "finished", params: {}, modeKey: null });
    });

    it("uses keys that exist in both locales", () => {
        const locales = ["es_CL", "en_US"].map(locale => JSON.parse(readFileSync(
            new URL(`../../../locales/${locale}.json`, import.meta.url), "utf8")));
        const labels = [
            activityListStatusLabel(activityListStatus(NOT_STARTED)),
            activityListStatusLabel(activityListStatus(IN_PROGRESS)),
            activityListStatusLabel(activityListStatus({
                ...IN_PROGRESS, currentPhase: { number: 1 },
            })),
            activityListStatusLabel({ id: LIST_STATUS_IN_PROGRESS, phase: null }),
            activityListStatusLabel(activityListStatus(FINISHED)),
        ];
        const keys = labels.flatMap(label => [label.key, label.modeKey].filter(Boolean));

        for (const catalog of locales) {
            for (const key of keys) {
                assert.equal(typeof catalog[key], "string", key);
            }
        }
    });
});
