import assert from "node:assert/strict";
import test from "node:test";

import { sha256Text } from "../analysis-input-hash.js";
import {
    ARGUMENTATION_TUTOR_SERVICE_ID,
    findTutorQuestion,
    selectTutorQuestions,
    tutorQuestionId,
} from "../design-tutor-questions.js";

const TUTOR = { externalServices: { enabledServiceIds: [" argumentation-tutor-system "] } };

test("selectTutorQuestions: non-empty questions of tutor phases, 1-based like stages and orden", () => {
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

    assert.deepEqual(selectTutorQuestions(design), [
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

test("selectTutorQuestions: ranking designs and malformed designs select nothing", () => {
    assert.deepEqual(selectTutorQuestions({ type: "ranking", phases: [{ ...TUTOR }] }), []);
    assert.deepEqual(selectTutorQuestions(null), []);
    assert.deepEqual(selectTutorQuestions({ type: "semantic_differential" }), []);
    assert.deepEqual(selectTutorQuestions({
        type:   "semantic_differential",
        phases: [{ ...TUTOR, questions: "not a list" }, null],
    }), []);
});

test("selectTutorQuestions: another service can be named", () => {
    const design = {
        type:   "semantic_differential",
        phases: [{
            externalServices: { enabledServiceIds: ["other-service"] },
            questions:        [{ q_text: "Q" }],
        }],
    };

    assert.deepEqual(selectTutorQuestions(design), []);
    assert.equal(selectTutorQuestions(design, { serviceId: "other-service" })[0].id, "p1-q1");
});

test("tutorQuestionId and the tutor's service id", () => {
    assert.equal(tutorQuestionId(3, 12), "p3-q12");
    assert.equal(ARGUMENTATION_TUTOR_SERVICE_ID, "argumentation-tutor-system");
});

test("findTutorQuestion: the tutor question at a runtime position (#850)", () => {
    const design = {
        type:   "semantic_differential",
        phases: [
            { questions: [{ q_text: "No tutor here." }] },
            { ...TUTOR, questions: [{ q_text: " " }, { q_text: "Should Ana report it?" }] },
        ],
    };

    assert.equal(findTutorQuestion(design, { phaseNumber: 2, questionNumber: 2 }).text,
        "Should Ana report it?");
    assert.equal(findTutorQuestion(design, { phaseNumber: 2, questionNumber: 1 }), null);
    assert.equal(findTutorQuestion(design, { phaseNumber: 1, questionNumber: 1 }), null);
    assert.equal(findTutorQuestion(design, { phaseNumber: null, questionNumber: 2 }), null);
    assert.equal(findTutorQuestion(null, { phaseNumber: 2, questionNumber: 2 }), null);
});
