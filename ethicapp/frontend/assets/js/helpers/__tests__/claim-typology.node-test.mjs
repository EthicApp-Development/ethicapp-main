import assert from "node:assert/strict";
import crypto from "node:crypto";
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
    questionTextHashes,
    selectTutorQuestions,
    sha256Text,
} from "../claim-typology.js";

const TUTOR = { externalServices: { enabledServiceIds: [" argumentation-tutor-system "] } };

const DESIGN = {
    type:   "semantic_differential",
    phases: [
        { ...TUTOR, questions: [{ q_text: "Should Camila omit the data?" }, { q_text: " " }, { q_text: "Why?" }] },
        { questions: [{ q_text: "Not discussed with the tutor." }] },
        {
            ...TUTOR,
            questions: [{ q_text: "**Is** the request acceptable?", q_text_content_type: "text/markdown" }],
        },
    ],
};

// The backend's sha256Text() (helpers/analysis-input-hash.js).
const nodeHash = text => `sha256:${crypto.createHash("sha256").update(text, "utf8").digest("hex")}`;

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

describe("selectTutorQuestions", () => {
    it("selects the non-empty questions of tutor phases with positional ids, as plain text", () => {
        assert.deepEqual(selectTutorQuestions(DESIGN), [
            { id: "p1-q1", phaseNumber: 1, questionNumber: 1, text: "Should Camila omit the data?" },
            { id: "p1-q3", phaseNumber: 1, questionNumber: 3, text: "Why?" },
            { id: "p3-q1", phaseNumber: 3, questionNumber: 1, text: "Is the request acceptable?" },
        ]);
    });

    it("selects nothing for ranking designs and designs without tutor phases", () => {
        assert.deepEqual(selectTutorQuestions({ ...DESIGN, type: "ranking" }), []);
        assert.deepEqual(selectTutorQuestions({ type: "semantic_differential", phases: [{ questions: [] }] }), []);
        assert.deepEqual(selectTutorQuestions(null), []);
    });
});

describe("sha256Text", () => {
    it("hashes as the backend does", async () => {
        for (const text of ["Why?", "¿Debería Camila omitir los datos?", ""]) {
            assert.equal(await sha256Text(text), nodeHash(text));
        }
    });

    it("is null without Web Crypto", async () => {
        assert.equal(await sha256Text("Why?", null), null);
    });

    it("hashes every question by id", async () => {
        const questions = selectTutorQuestions(DESIGN);
        assert.deepEqual(await questionTextHashes(questions), {
            "p1-q1": nodeHash("Should Camila omit the data?"),
            "p1-q3": nodeHash("Why?"),
            "p3-q1": nodeHash("Is the request acceptable?"),
        });
    });
});

describe("claimTypologyQuestions", () => {
    const questions = selectTutorQuestions(DESIGN);
    const hashes = {
        "p1-q1": "sha256:one",
        "p1-q3": "sha256:three",
        "p3-q1": "sha256:five",
    };

    it("pairs each question with its typology and cited evidence", () => {
        const document = { typologies: [typology("p1-q1", { questionTextHash: "sha256:one" })] };
        const facts = evidenceFactsById({ facts: [{ id: "EV2", label: "request", statement: "Andrea asks." }] });

        const [first, second] = claimTypologyQuestions({ questions, hashes, document, facts });

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

    it("reports a typology out of date when its question text changed", () => {
        const document = {
            typologies: [
                typology("p1-q1", { questionTextHash: "sha256:old" }),
                typology("p1-q3", { questionTextHash: null }),
                typology("p3-q1", { questionTextHash: "sha256:five" }),
            ],
        };

        const views = claimTypologyQuestions({ questions, hashes, document });
        assert.deepEqual(views.map(view => [view.id, view.outOfDate]), [
            ["p1-q1", true],
            ["p1-q3", false],
            ["p3-q1", false],
        ]);

        const withoutHashes = claimTypologyQuestions({ questions, hashes: {}, document });
        assert.equal(withoutHashes.some(view => view.outOfDate), false,
            "without Web Crypto nothing is reported out of date");
    });
});

describe("claimTypologyView", () => {
    const questions = claimTypologyQuestions({
        questions: selectTutorQuestions(DESIGN),
        hashes:    { "p1-q1": "sha256:new" },
        document:  { typologies: [typology("p1-q1", { questionTextHash: "sha256:old" })] },
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
});

describe("claim typology labels", () => {
    it("maps stances to labels", () => {
        assert.equal(claimTypologyStance("against").labelClass, "label-danger");
        assert.equal(claimTypologyStance("alternative").key, "claim_typology_stance_alternative");
        assert.equal(claimTypologyStance("conditional").labelClass, "label-warning");
        assert.equal(claimTypologyStance("other").key, "claim_typology_stance_unknown");
    });

    it("explains error codes, falling back to a generic text", () => {
        assert.equal(claimTypologyErrorKey("service-failed"), "claim_typology_error_service_failed");
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
    const questions = selectTutorQuestions(DESIGN);
    const design = { userOwned: true, locked: false, caseId: 57 };

    it("allows the owner of an unlocked design with a case and tutor questions", () => {
        assert.equal(canGenerateClaimTypology({ design, analysis: null, questions }), true);
        assert.equal(canGenerateClaimTypology({
            design, analysis: { status: "requested", stale: true }, questions,
        }), true, "a stale generation can be replaced");
    });

    it("refuses otherwise", () => {
        assert.equal(canGenerateClaimTypology({ design: { ...design, locked: true }, analysis: null, questions }), false);
        assert.equal(canGenerateClaimTypology({ design: { ...design, userOwned: false }, analysis: null, questions }), false);
        assert.equal(canGenerateClaimTypology({ design: { ...design, caseId: null }, analysis: null, questions }), false);
        assert.equal(canGenerateClaimTypology({ design, analysis: null, questions: [] }), false);
        assert.equal(canGenerateClaimTypology({
            design, analysis: { status: "processing", stale: false }, questions,
        }), false);
    });
});
