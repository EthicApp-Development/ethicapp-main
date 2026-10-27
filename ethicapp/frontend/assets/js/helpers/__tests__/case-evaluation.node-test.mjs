import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { describe, it } from "node:test";

import {
    buildCaseEvaluationView,
    CASE_EVALUATION_CRITERIA,
    CASE_EVALUATION_EVALUATORS,
    criteriaCountKey,
    criterionLabel,
    evaluatorLabel,
} from "../case-evaluation.js";
import { CASE_ANALYSIS_COMPONENTS, caseAnalysisErrorKey, resolveCaseAnalysisComponent } from "../case-analyses.js";

const LOCALES = Object.fromEntries(await Promise.all(["es_CL", "en_US"].map(async locale => [
    locale,
    JSON.parse(await fs.readFile(new URL(`../../../locales/${locale}.json`, import.meta.url), "utf8")),
])));

// A `case-evaluation/v1` document, trimmed from Case Analyst's example.
function evaluationDocument() {
    return {
        schemaVersion: "case-evaluation/v1",
        language:      "es_CL",
        evaluations:   [
            {
                evaluator: "prompt001",
                prompt:    "prompt001Narrative/v2",
                results:   [
                    { criterion: "writing_clarity", feedback: " Claro. ", evidence: [], suggestion: "" },
                ],
            },
            {
                evaluator: "prompt003",
                prompt:    "prompt003Dilemmatic/v2",
                results:   [
                    {
                        criterion:  "decision_complexity",
                        feedback:   "La decisión parece obvia.",
                        evidence:   ["la ley chilena prohíbe la discriminación", " "],
                        suggestion: "Agregar un costo real.",
                    },
                ],
            },
            {
                evaluator: "prompt001",
                prompt:    "prompt001Narrative/v3",
                results:   [
                    { criterion: "tone_balance", feedback: "Nuevo.", evidence: [], suggestion: "" },
                ],
            },
        ],
        synthesis: {
            prompt:         "promptSynthesizer/v2",
            selectedIssues: [
                {
                    priority:        2,
                    issue:           "Segundo.",
                    selectionReason: "",
                    caseEvidence:    [],
                    recommendation:  "R2.",
                    supportedBy:     [],
                },
                {
                    priority:        1,
                    issue:           "La decisión es obvia.",
                    selectionReason: "Debilita la discusión.",
                    caseEvidence:    ["la ley chilena prohíbe la discriminación"],
                    recommendation:  "Agregar un costo real.",
                    supportedBy:     [{ evaluator: "prompt003", criterion: "decision_complexity" }],
                },
            ],
            finalFeedback: {
                summary:         "Un caso claro.",
                recommendations: [
                    { priority: 2, recommendation: "R2.", caseEvidence: [] },
                    { priority: 1, recommendation: "R1.", caseEvidence: ["cita"] },
                ],
            },
        },
    };
}

describe("buildCaseEvaluationView", () => {
    it("orders the synthesis by priority and keeps the quotes", () => {
        const view = buildCaseEvaluationView(evaluationDocument());

        assert.equal(view.summary, "Un caso claro.");
        assert.deepEqual(view.recommendations.map(item => item.priority), [1, 2]);
        assert.deepEqual(view.recommendations[0].caseEvidence, ["cita"]);
        assert.deepEqual(view.issues.map(issue => issue.priority), [1, 2]);
        assert.deepEqual(view.issues[0], {
            priority:        1,
            issue:           "La decisión es obvia.",
            selectionReason: "Debilita la discusión.",
            caseEvidence:    ["la ley chilena prohíbe la discriminación"],
            recommendation:  "Agregar un costo real.",
            supportedBy:     [{
                evaluator: "prompt003",
                criterion: { key: "case_evaluation_criterion_decision_complexity", fallback: "decision_complexity" },
            }],
        });
    });

    it("groups the criteria by evaluator in document order, merging repeated evaluators", () => {
        const view = buildCaseEvaluationView(evaluationDocument());

        assert.deepEqual(view.evaluators.map(group => group.evaluator), ["prompt001", "prompt003"]);
        assert.deepEqual(view.evaluators.map(group => group.countKey), [
            "case_evaluation_criteria_count_other",
            "case_evaluation_criteria_count_one",
        ]);
        assert.deepEqual(view.evaluators[0].results.map(result => result.criterion),
            ["writing_clarity", "tone_balance"]);
        assert.deepEqual(view.evaluators[1].results[0], {
            criterion:  "decision_complexity",
            label:      { key: "case_evaluation_criterion_decision_complexity", fallback: "decision_complexity" },
            feedback:   "La decisión parece obvia.",
            evidence:   ["la ley chilena prohíbe la discriminación"],
            suggestion: "Agregar un costo real.",
        });
        assert.equal(view.evaluators[0].results[0].feedback, "Claro.");
    });

    it("renders missing or malformed parts as empty", () => {
        const empty = { summary: "", recommendations: [], issues: [], evaluators: [] };

        assert.deepEqual(buildCaseEvaluationView(null), empty);
        assert.deepEqual(buildCaseEvaluationView({ evaluations: "x", synthesis: [] }), empty);
        assert.deepEqual(
            buildCaseEvaluationView({ evaluations: [{ evaluator: "prompt001", results: [null] }] }),
            empty
        );
    });
});

describe("labels", () => {
    it("counts criteria in the singular for one", () => {
        assert.equal(criteriaCountKey(1), "case_evaluation_criteria_count_one");
        assert.equal(criteriaCountKey(0), "case_evaluation_criteria_count_other");
        assert.equal(criteriaCountKey(3), "case_evaluation_criteria_count_other");
        assert.equal(LOCALES.es_CL.case_evaluation_criteria_count_one, "{{count}} criterio");
        assert.equal(LOCALES.en_US.case_evaluation_criteria_count_one, "{{count}} criterion");
    });

    it("translates known criteria and evaluators and builds a label for new ones", () => {
        assert.deepEqual(criterionLabel("ethical_conflict"),
            { key: "case_evaluation_criterion_ethical_conflict", fallback: "ethical_conflict" });
        assert.deepEqual(criterionLabel("tone_balance"), { key: null, fallback: "Tone balance" });
        assert.deepEqual(criterionLabel(null), { key: null, fallback: "" });
        assert.deepEqual(evaluatorLabel("prompt006"),
            { key: "case_evaluation_evaluator_prompt006", fallback: "prompt006" });
        assert.deepEqual(evaluatorLabel("prompt099"), { key: null, fallback: "prompt099" });
    });

    it("every label key exists in both locales", () => {
        const keys = [
            ...CASE_EVALUATION_CRITERIA.map(criterion => criterionLabel(criterion).key),
            ...CASE_EVALUATION_EVALUATORS.map(evaluator => evaluatorLabel(evaluator).key),
            criteriaCountKey(1),
            criteriaCountKey(2),
        ];

        for (const [locale, catalog] of Object.entries(LOCALES)) {
            for (const key of keys) {
                assert.ok(catalog[key], `${locale} lacks ${key}`);
            }
        }
    });
});

describe("case analysis registration", () => {
    it("compiles the case evaluation view for its manifest component", () => {
        assert.equal(CASE_ANALYSIS_COMPONENTS["case-evaluation"], "case-evaluation-view");
        assert.equal(resolveCaseAnalysisComponent("case-evaluation"), "case-evaluation-view");
    });

    it("explains every code of the shared error vocabulary in both locales", () => {
        const codes = [
            "no-document",
            "render-failed",
            "superseded",
            "timeout",
            "empty-case-text",
            "case-text-too-long",
            "request-failed",
            "request-rejected",
            "invalid-result",
            "service-llm-error",
            "service-llm-refusal",
            "service-invalid-output",
            "service-timeout",
            "service-worker-lost",
            "service-internal-error",
            "adapter-error",
            "generation-not-started",
        ];

        for (const code of codes) {
            const key = caseAnalysisErrorKey(code);
            assert.notEqual(key, "case_analysis_error_generic", code);
            for (const [locale, catalog] of Object.entries(LOCALES)) {
                assert.ok(catalog[key], `${locale} lacks ${key}`);
            }
        }
    });
});
