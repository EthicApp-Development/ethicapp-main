import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    canGenerateClaimTypology,
    citesEvidence,
    claimTypologyErrorKey,
    claimTypologyGenerateNotice,
    claimTypologyQuestions,
    claimTypologyStance,
    claimTypologyView,
    evidenceFactsById,
} from "../claim-typology.js";

// The units the backend selects for the typology (#865), with their hashes.
const UNITS = Object.freeze([
    { id: "p1-q1", phaseNumber: 1, questionNumber: 1, text: "Should Camila omit the data?", textHash: "sha256:one" },
    { id: "p1-q3", phaseNumber: 1, questionNumber: 3, text: "Why?", textHash: "sha256:three" },
    { id: "p3-q1", phaseNumber: 3, questionNumber: 1, text: "Is the request acceptable?", textHash: "sha256:five" },
]);

function typology(questionId, overrides = {}) {
    return {
        questionId,
        phaseId:          Number(questionId.slice(1, 2)),
        focalAction:      `Focal action of ${questionId}`,
        questionTextHash: null,
        types:            [
            {
                id:                 "AF1",
                label:              "Omit",
                description:        "Leave the data out.",
                stance:             "in_favor",
                exampleStatement:   "I would leave them out.",
                relatedEvidenceIds: ["EV2", "EV9"],
            },
            { id: "AF2", label: "Include", description: "Report everything.", stance: "against" },
        ],
        ...overrides,
    };
}

describe("claimTypologyQuestions", () => {
    it("pairs each unit with its typology and cited evidence", () => {
        const document = { typologies: [typology("p1-q1", { questionTextHash: "sha256:one" })] };
        const facts = evidenceFactsById({ facts: [{ id: "EV2", label: "request", statement: "Andrea asks." }] });

        const [first, second] = claimTypologyQuestions({ units: UNITS, document, facts });

        assert.deepEqual(
            [first.id, first.phaseNumber, first.questionNumber, first.text],
            ["p1-q1", 1, 1, "Should Camila omit the data?"]
        );

        assert.equal(first.outOfDate, false);
        assert.equal(first.typology.focalAction, "Focal action of p1-q1");
        assert.deepEqual(first.typology.types[0], {
            id:               "AF1",
            label:            "Omit",
            description:      "Leave the data out.",
            exampleStatement: "I would leave them out.",
            stance:           { key: "claim_typology_stance_in_favor", labelClass: "label-success" },
            evidence:         [{ id: "EV2", statement: "Andrea asks." }, { id: "EV9", statement: null }],
        });
        assert.equal(first.typology.types[1].exampleStatement, null);
        assert.deepEqual(first.typology.types[1].evidence, []);
        assert.equal(second.typology, null);
        assert.equal(second.outOfDate, false);
    });

    it("reports a typology out of date when it answers another text, or records none", () => {
        const document = {
            typologies: [
                typology("p1-q1", { questionTextHash: "sha256:old" }),
                typology("p1-q3", { questionTextHash: null }),
                typology("p3-q1", { questionTextHash: "sha256:five" }),
            ],
        };

        const views = claimTypologyQuestions({ units: UNITS, document });
        assert.deepEqual(views.map(view => [view.id, view.outOfDate]), [
            ["p1-q1", true],
            ["p1-q3", true],
            ["p3-q1", false],
        ]);
    });

    it("adds the note on each question's expected tutor mode", () => {
        const views = claimTypologyQuestions({
            units:      UNITS,
            tutorModes: {
                "p1-q1": { mode: "enhanced", reason: null },
                "p1-q3": { mode: "basic", reason: "no-inventory" },
            },
        });

        assert.deepEqual(views.map(view => view.tutorMode), [
            { enhanced: true, selected: false, reasonKey: null, action: null },
            {
                enhanced: false, selected: false, reasonKey: "tutor_mode_reason_no_inventory", action: "open-case",
            },
            null,
        ]);
    });

    it("lists nothing without units", () => {
        assert.deepEqual(claimTypologyQuestions({ units: null, document: { typologies: [typology("p1-q1")] } }), []);
    });
});

describe("claimTypologyView", () => {
    const questions = claimTypologyQuestions({
        units:    UNITS,
        document: { typologies: [typology("p1-q1", { questionTextHash: "sha256:old" })] },
    });

    it("groups the questions by phase and counts what needs attention", () => {
        const view = claimTypologyView({
            analysis: { status: "ready", stale: false, document: { typologies: [] } },
            questions,
        });

        assert.equal(view.state, "ready");
        assert.equal(view.inFlight, false);
        assert.deepEqual(Object.keys(view.byPhase), ["1", "3"]);
        assert.deepEqual(view.byPhase[1].map(question => question.id), ["p1-q1", "p1-q3"]);
        assert.equal(view.outOfDateCount, 1);
        assert.equal(view.missingCount, 2);
    });

    it("reports the generation state", () => {
        assert.equal(claimTypologyView({ analysis: null, questions }).state, "none");
        assert.equal(claimTypologyView({ analysis: null, questions }).missingCount, 0);

        const pending = claimTypologyView({ analysis: { status: "processing", stale: false }, questions });
        assert.equal(pending.state, "pending");
        assert.equal(pending.inFlight, true);

        const stuck = claimTypologyView({ analysis: { status: "requested", stale: true }, questions });
        assert.equal(stuck.state, "stuck");
        assert.equal(stuck.inFlight, false);

        assert.equal(claimTypologyView({ analysis: { status: "failed" }, questions }).state, "failed");
    });

    it("explains why no question is covered", () => {
        assert.equal(claimTypologyView({ analysis: null, questions, unitsReason: null }).unitsReasonKey, null);
        assert.equal(
            claimTypologyView({ analysis: null, questions: [], unitsReason: "consumers-unusable" }).unitsReasonKey,
            "claim_typology_units_consumers_unusable"
        );
        assert.equal(claimTypologyView({ analysis: null, questions: [], unitsReason: "other" }).unitsReasonKey, null);
        assert.equal(
            claimTypologyView({ analysis: null, questions: [], unitsReason: "not-needed" }).unitsReasonKey,
            "claim_typology_units_not_needed"
        );
    });

    // A basic phase and an enhanced one (#870): the backend lists only the
    // enhanced phase's questions as units, and says the basic phase chose it.
    it("notes the phases that chose the basic mode, without listing their questions", () => {
        const enhancedOnly = claimTypologyQuestions({ units: UNITS.filter(unit => unit.phaseNumber === 3) });
        const view = claimTypologyView({
            analysis:    { status: "ready", stale: false, document: { typologies: [] } },
            questions:   enhancedOnly,
            tutorPhases: [
                { phaseNumber: 1, requestedMode: "basic", reason: "basic-selected" },
                { phaseNumber: 3, requestedMode: "enhanced", reason: null },
            ],
        });

        assert.deepEqual(view.phaseNotes, {
            1: { reason: "basic-selected", reasonKey: "tutor_mode_basic_selected_note" },
        });
        assert.deepEqual(Object.keys(view.byPhase), ["3"], "phase 1 is not awaiting a typology");
        assert.equal(view.missingCount, 1, "only the enhanced phase's question is missing");
        assert.deepEqual(claimTypologyView({ analysis: null, questions: [] }).phaseNotes, {});
    });
});

describe("claim typology labels", () => {
    it("maps stances to labels", () => {
        assert.equal(claimTypologyStance("against").labelClass, "label-danger");
        assert.equal(claimTypologyStance("alternative").key, "claim_typology_stance_alternative");
        assert.equal(claimTypologyStance("conditional").labelClass, "label-warning");
        assert.equal(claimTypologyStance("other").key, "claim_typology_stance_unknown");
    });

    it("explains error codes, falling back to a generic text", () => {
        assert.equal(claimTypologyErrorKey("adapter-error"), "case_analysis_error_adapter_error");
        assert.equal(claimTypologyErrorKey("timeout"), "case_analysis_error_timeout");
        assert.equal(claimTypologyErrorKey("toString"), "case_analysis_error_generic");
        assert.equal(claimTypologyErrorKey(null), "case_analysis_error_generic");
    });

    it("explains generate answers", () => {
        assert.equal(claimTypologyGenerateNotice("locked").key, "claim_typology_locked_note");
        assert.equal(claimTypologyGenerateNotice("not-applicable").key,
            "claim_typology_generate_not_applicable");
        assert.equal(claimTypologyGenerateNotice("unexpected").type, "danger");
    });
});

describe("citesEvidence and evidenceFactsById", () => {
    it("detects cited evidence", () => {
        assert.equal(citesEvidence({ typologies: [typology("p1-q1")] }), true);
        assert.equal(citesEvidence({
            typologies: [typology("p1-q1", { types: [{ id: "AF1", relatedEvidenceIds: [] }] })],
        }), false);
        assert.equal(citesEvidence(null), false);
    });

    it("indexes facts and ignores malformed ones", () => {
        assert.deepEqual(evidenceFactsById({ facts: [{ id: "EV1", statement: "S" }, null, { label: "x" }] }), {
            EV1: { label: null, statement: "S" },
        });
        assert.deepEqual(evidenceFactsById(null), {});
    });
});

describe("canGenerateClaimTypology", () => {
    const design = { userOwned: true, locked: false, caseId: 57 };
    const allowed = { design, analysis: null, units: UNITS, producerUsable: true };

    it("allows the owner of an unlocked design with a case, covered questions and a usable service", () => {
        assert.equal(canGenerateClaimTypology(allowed), true);
        assert.equal(canGenerateClaimTypology({
            ...allowed, analysis: { status: "requested", stale: true },
        }), true, "a stale generation can be replaced");
    });

    it("refuses otherwise", () => {
        assert.equal(canGenerateClaimTypology({ ...allowed, design: { ...design, locked: true } }), false);
        assert.equal(canGenerateClaimTypology({ ...allowed, design: { ...design, userOwned: false } }), false);
        assert.equal(canGenerateClaimTypology({ ...allowed, design: { ...design, caseId: null } }), false);
        assert.equal(canGenerateClaimTypology({ ...allowed, units: [] }), false);
        assert.equal(canGenerateClaimTypology({ ...allowed, producerUsable: false }), false,
            "a switched-off typology service is not offered");
        assert.equal(canGenerateClaimTypology({
            ...allowed, analysis: { status: "processing", stale: false },
        }), false);
    });
});
