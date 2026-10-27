import assert from "node:assert/strict";
import test from "node:test";

import { sha256Text } from "../analysis-input-hash.js";
import {
    findQuestionUnit,
    QUESTION_UNIT,
    questionUnitId,
    selectDesignAnalysisUnits,
    selectQuestionUnits,
} from "../design-analysis-units.js";

const TUTOR_ID = "argumentation-tutor-system";
const TUTOR = { externalServices: { enabledServiceIds: [" argumentation-tutor-system "] } };

// ─── selectQuestionUnits ─────────────────────────────────────────────────────

test("selectQuestionUnits: non-empty questions of the phases, 1-based like stages and orden", () => {
    const design = {
        type:   "semantic_differential",
        phases: [
            { questions: [{ q_text: "Phase without the tutor." }] },
            {
                ...TUTOR,
                questions: [
                    { q_text: "" },
                    { q_text: "  Should Ana report it?  " },
                    { q_text: "_Why_?", q_text_content_type: "text/markdown" },
                ],
            },
        ],
    };

    assert.deepEqual(selectQuestionUnits(design, { serviceIds: [TUTOR_ID] }), [
        {
            id:             "p2-q2",
            phaseNumber:    2,
            questionNumber: 2,
            text:           "Should Ana report it?",
            textHash:       sha256Text("Should Ana report it?"),
        },
        {
            id:             "p2-q3",
            phaseNumber:    2,
            questionNumber: 3,
            text:           "Why?",
            textHash:       sha256Text("Why?"),
        },
    ]);
});

test("selectQuestionUnits: ranking designs, malformed designs and no services select nothing", () => {
    const options = { serviceIds: [TUTOR_ID] };
    assert.deepEqual(selectQuestionUnits({ type: "ranking", phases: [{ ...TUTOR }] }, options), []);
    assert.deepEqual(selectQuestionUnits(null, options), []);
    assert.deepEqual(selectQuestionUnits({ type: "semantic_differential" }, options), []);
    assert.deepEqual(selectQuestionUnits({
        type:   "semantic_differential",
        phases: [{ ...TUTOR, questions: "not a list" }, null],
    }, options), []);

    const design = { type: "semantic_differential", phases: [{ ...TUTOR, questions: [{ q_text: "Q" }] }] };
    assert.deepEqual(selectQuestionUnits(design), []);
    assert.deepEqual(selectQuestionUnits(design, { serviceIds: [] }), []);
});

test("selectQuestionUnits: a phase is selected when it enables any of the services", () => {
    const design = {
        type:   "semantic_differential",
        phases: [
            { externalServices: { enabledServiceIds: ["other-service"] }, questions: [{ q_text: "Q1" }] },
            { ...TUTOR, questions: [{ q_text: "Q2" }] },
            { externalServices: { enabledServiceIds: ["unrelated"] }, questions: [{ q_text: "Q3" }] },
        ],
    };

    assert.deepEqual(selectQuestionUnits(design, { serviceIds: ["other-service"] }).map(unit => unit.id), ["p1-q1"]);
    assert.deepEqual(
        selectQuestionUnits(design, { serviceIds: new Set([TUTOR_ID, "other-service"]) }).map(unit => unit.id),
        ["p1-q1", "p2-q1"]
    );
});

test("questionUnitId and the question unit", () => {
    assert.equal(questionUnitId(3, 12), "p3-q12");
    assert.equal(QUESTION_UNIT, "question");
});

test("findQuestionUnit: the question at a runtime position (#850)", () => {
    const design = {
        type:   "semantic_differential",
        phases: [
            { questions: [{ q_text: "No tutor here." }] },
            { ...TUTOR, questions: [{ q_text: " " }, { q_text: "Should Ana report it?" }] },
        ],
    };
    const find = position => findQuestionUnit(design, position, { serviceIds: [TUTOR_ID] });

    assert.equal(find({ phaseNumber: 2, questionNumber: 2 }).text, "Should Ana report it?");
    assert.equal(find({ phaseNumber: 2, questionNumber: 1 }), null);
    assert.equal(find({ phaseNumber: 1, questionNumber: 1 }), null);
    assert.equal(find({ phaseNumber: null, questionNumber: 2 }), null);
    assert.equal(findQuestionUnit(null, { phaseNumber: 2, questionNumber: 2 }, { serviceIds: [TUTOR_ID] }), null);
    assert.equal(findQuestionUnit(design, { phaseNumber: 2, questionNumber: 2 }), null);
});

// ─── selectDesignAnalysisUnits ───────────────────────────────────────────────

function fakeRegistry({ consumers = {}, usable = null } = {}) {
    const calls = { consumers: [], usable: [] };
    return {
        calls,
        getDesignAnalysisConsumerIds(producerId, options) {
            calls.consumers.push({ producerId, ...options });
            return consumers[producerId] ?? [];
        },
        async usableServiceIds(serviceIds) {
            calls.usable.push(serviceIds);
            return usable === null ? serviceIds : serviceIds.filter(id => usable.includes(id));
        },
    };
}

const DESIGN = {
    type:   "semantic_differential",
    phases: [
        { externalServices: { enabledServiceIds: ["consumer-a"] }, questions: [{ q_text: "A?" }] },
        { externalServices: { enabledServiceIds: ["consumer-b", "consumer-a"] }, questions: [{ q_text: "AB?" }] },
        { externalServices: { enabledServiceIds: ["consumer-b"] }, questions: [{ q_text: "B?" }] },
        { externalServices: { enabledServiceIds: ["other"] }, questions: [{ q_text: "Other?" }] },
    ],
};

test("selectDesignAnalysisUnits: the questions of phases that enable a usable consumer", async () => {
    const registry = fakeRegistry({ consumers: { producer: ["consumer-a", "consumer-b", "consumer-c"] } });

    const units = await selectDesignAnalysisUnits({ producerId: "producer", design: DESIGN }, { registry });

    assert.deepEqual(units.map(unit => unit.id), ["p1-q1", "p2-q1", "p3-q1"]);
    assert.deepEqual(registry.calls.consumers, [{ producerId: "producer", unit: "question" }]);
    assert.deepEqual(registry.calls.usable, [["consumer-a", "consumer-b"]],
        "only the consumers the design enables are checked against the policy");
});

test("selectDesignAnalysisUnits: an unusable consumer's phases drop unless another consumer is usable", async () => {
    const registry = fakeRegistry({
        consumers: { producer: ["consumer-a", "consumer-b"] },
        usable:    ["consumer-b"],
    });

    const units = await selectDesignAnalysisUnits({ producerId: "producer", design: DESIGN }, { registry });

    assert.deepEqual(units.map(unit => unit.id), ["p2-q1", "p3-q1"]);
});

test("selectDesignAnalysisUnits: no consumer, no usable consumer or no question selects nothing", async () => {
    const select = (registry, design = DESIGN, unit) => selectDesignAnalysisUnits(
        { producerId: "producer", design, unit },
        { registry }
    );

    const none = fakeRegistry();
    assert.deepEqual(await select(none), []);
    assert.deepEqual(none.calls.usable, [], "the policy is not read without a consumer");

    const elsewhere = fakeRegistry({ consumers: { producer: ["consumer-z"] } });
    assert.deepEqual(await select(elsewhere), []);
    assert.deepEqual(elsewhere.calls.usable, [], "the policy is not read when no phase enables a consumer");

    assert.deepEqual(await select(fakeRegistry({ consumers: { producer: ["consumer-a"] }, usable: [] })), []);

    const ranking = fakeRegistry({ consumers: { producer: ["consumer-a"] } });
    assert.deepEqual(await select(ranking, { ...DESIGN, type: "ranking" }), []);
    assert.deepEqual(await select(ranking, null), []);
    assert.deepEqual(await select(ranking, DESIGN, "phase"), [], "only question units exist");
    assert.deepEqual(ranking.calls.consumers, []);
});
