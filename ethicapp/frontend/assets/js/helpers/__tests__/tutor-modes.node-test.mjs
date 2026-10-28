import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
    announcesTutorSession,
    basicTutorSessions,
    claimTypologyUnitsReasonKey,
    TUTOR_MODE_ACTIONS,
    tutorModeNote,
    tutorModeReasonKey,
} from "../tutor-modes.js";

// Every reason the backend gives (TUTOR_MODE_REASONS in
// ethicapp/backend/helpers/tutor-mode.js).
const REASONS = [
    "inventory-disabled",
    "inventory-failed",
    "no-inventory",
    "typology-disabled",
    "typology-pending",
    "typology-failed",
    "typology-out-of-date",
    "no-typology",
    "tutor-unsupported",
    "context-rejected",
];

const locale = name => JSON.parse(readFileSync(
    new URL(`../../../locales/${name}.json`, import.meta.url),
    "utf8"
));

describe("tutorModeReasonKey", () => {
    it("explains every reason in both locales", () => {
        const catalogs = [locale("es_CL"), locale("en_US")];
        const keys = REASONS.map(tutorModeReasonKey);

        assert.equal(new Set(keys).size, REASONS.length, "one text per reason");
        for (const key of [...keys, tutorModeReasonKey("unknown"), "tutor_mode_basic_expected",
            "tutor_mode_enhanced_available", "tutor_mode_activity_question_basic"]) {
            for (const catalog of catalogs) {
                assert.equal(typeof catalog[key], "string", key);
            }
        }
    });

    it("falls back to a generic text", () => {
        assert.equal(tutorModeReasonKey("toString"), "tutor_mode_reason_unknown");
        assert.equal(tutorModeReasonKey(null), "tutor_mode_reason_unknown");
    });
});

describe("tutorModeNote", () => {
    it("says when the advanced evaluation is available", () => {
        assert.deepEqual(tutorModeNote({ mode: "enhanced", reason: null }),
            { enhanced: true, reasonKey: null, action: null });
    });

    it("explains the basic mode and offers what helps", () => {
        assert.deepEqual(tutorModeNote({ mode: "basic", reason: "no-inventory" }), {
            enhanced:  false,
            reasonKey: "tutor_mode_reason_no_inventory",
            action:    TUTOR_MODE_ACTIONS.OPEN_CASE,
        });
        assert.equal(tutorModeNote({ mode: "basic", reason: "typology-out-of-date" }).action,
            TUTOR_MODE_ACTIONS.GENERATE_TYPOLOGY);
        assert.equal(tutorModeNote({ mode: "basic", reason: "typology-pending" }).action, null,
            "nothing to do while it is generated");
        assert.equal(tutorModeNote({ mode: "basic", reason: "typology-disabled" }).action, null);
    });

    it("is null without a mode", () => {
        assert.equal(tutorModeNote(undefined), null);
        assert.equal(tutorModeNote(null), null);
    });
});

describe("claimTypologyUnitsReasonKey", () => {
    it("explains why no question is covered", () => {
        assert.equal(claimTypologyUnitsReasonKey("consumers-unusable"), "claim_typology_units_consumers_unusable");
        assert.equal(claimTypologyUnitsReasonKey("no-consumer"), "claim_typology_units_no_consumer");
        assert.equal(claimTypologyUnitsReasonKey(null), null);
        assert.equal(claimTypologyUnitsReasonKey("toString"), null);
    });
});

describe("basicTutorSessions", () => {
    const records = [
        { phaseId: 20, questionKey: "p2-q2", questionNumber: 2, tutorMode: "basic", tutorModeReason: "no-typology" },
        { phaseId: 20, questionKey: "p2-q1", questionNumber: 1, tutorMode: "basic", tutorModeReason: "typology-pending" },
        { phaseId: 20, questionKey: "p2-q3", questionNumber: 3, tutorMode: "enhanced", tutorModeReason: null },
        { phaseId: 10, questionKey: "p1-q1", questionNumber: 1, tutorMode: "basic", tutorModeReason: "no-inventory" },
        { phaseId: 20, questionKey: "phase", questionNumber: null, tutorMode: "basic", tutorModeReason: "no-typology" },
    ];

    it("lists the phase's basic-mode sessions by question number", () => {
        assert.deepEqual(basicTutorSessions(records, "20"), [
            { questionKey: "p2-q1", questionNumber: 1, reasonKey: "tutor_mode_reason_typology_pending" },
            { questionKey: "p2-q2", questionNumber: 2, reasonKey: "tutor_mode_reason_no_typology" },
            { questionKey: "phase", questionNumber: null, reasonKey: "tutor_mode_reason_no_typology" },
        ]);
    });

    it("lists nothing for malformed input", () => {
        assert.deepEqual(basicTutorSessions(null, 20), []);
        assert.deepEqual(basicTutorSessions(records, 99), []);
    });
});

describe("announcesTutorSession", () => {
    it("matches the tutor's announcements for the phase", () => {
        assert.equal(announcesTutorSession({ serviceId: "argumentation-tutor-system", phaseId: 20 }, "20"), true);
        assert.equal(announcesTutorSession({ serviceId: "argumentation-tutor-system", phaseId: 21 }, 20), false);
        assert.equal(announcesTutorSession({ serviceId: "polyadic-devils-advocate", phaseId: 20 }, 20), false);
        assert.equal(announcesTutorSession(null, 20), false);
    });
});
