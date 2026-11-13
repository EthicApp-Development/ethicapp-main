// The tutor's v19 rubric in EthicApp (#1214, epic ethicapp-ai-additions#267):
// a v19 callback carries `argumentEvaluation` (argument-evaluation/v1) and
// `rubric: "v19"` instead of the v12 score keys. The adapter reads the levels
// with the scales the payload gives them, maps them to the student's
// document without the evaluation's ids or texts, records them for teachers
// and exports them to the report. The payloads are built from the contract's
// examples, EthicApp's verbatim copy in canonical-schemas/ai-additions/.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { register } from "../ats-feedback.adapter.js";
import {
    argumentEvaluationOf,
    currentEvaluation,
    evaluationRecordOf,
    rubricOutcomeOf,
    tutorRubricOf,
} from "../ats-feedback.evaluation.js";
import {
    ATS_REPORT_COLUMNS,
    buildReportContribution,
    feedbackColumnValues,
} from "../ats-feedback.report.js";
import { readStudentResults } from "../ats-feedback.student-results.js";
import {
    buildAtsSessionPayload,
    buildFeedbackPayloadFromExternalResult,
    buildStudentFeedback,
    claimTypeFromExternalResult,
    createAtsSession,
    legacyStudentDocument,
    mappedStudentDocument,
    tutorEvaluationFromExternalResult,
} from "../ats-feedback.utils.js";
import { validateReportContribution } from "../../../services/external-service-report-contributions.js";
import { validateStudentResultDocument } from "../../../services/student-result-documents.js";

const SERVICE_ID = "argumentation-tutor-system";
const EXAMPLES_URL = new URL(
    "../../../../../canonical-schemas/ai-additions/examples/argument-evaluation.v1/",
    import.meta.url
);
const STUDENT_EXAMPLES_URL = new URL(
    "../../../../../canonical-schemas/ai-additions/examples/student-result.v1/",
    import.meta.url
);

async function readJson(url) {
    return JSON.parse(await fs.readFile(url, "utf8"));
}

const EXAMPLES = Object.freeze({
    analysis:   await readJson(new URL("analysis-enhanced.es_CL.json", EXAMPLES_URL)),
    entryRule:  await readJson(new URL("analysis-entry-rule.es_CL.json", EXAMPLES_URL)),
    noClaim:    await readJson(new URL("analysis-no-claim.es_CL.json", EXAMPLES_URL)),
    comparison: await readJson(new URL("comparison.es_CL.json", EXAMPLES_URL)),
});

const SESSION_ID = 5;
const PHASE_ID = 20;
const QUESTION_ID = 101;
const STUDENT_ID = 31;
const DESTINATION = Object.freeze({
    sessionId: SESSION_ID, phaseId: PHASE_ID, questionId: QUESTION_ID, userId: STUDENT_ID,
});

const ARGUMENT = "Yo no ayudaría a Sebastián a contestar el examen, porque su papá le dijo "
    + "que en su familia no se toman atajos.";
const PREVIOUS_ARGUMENT = "No corresponde ayudar a Sebastián en el examen.";

// A v19 callback payload: the destination, the rubric, the evaluation and
// the student's argument. Neither the v12 score keys nor a student document.
function v19Payload(argumentEvaluation, overrides = {}) {
    return {
        sessionId:          SESSION_ID,
        phaseId:            PHASE_ID,
        questionId:         QUESTION_ID,
        groupId:            7,
        userId:             String(STUDENT_ID),
        taskId:             "task-19",
        rubric:             "v19",
        argumentEvaluation: structuredClone(argumentEvaluation),
        argumentPreview:    ARGUMENT,
        ...overrides,
    };
}

// A v12 payload, as the tutor sends it today.
function v12Payload(overrides = {}) {
    return {
        sessionId:  SESSION_ID,
        phaseId:    PHASE_ID,
        questionId: QUESTION_ID,
        userId:     String(STUDENT_ID),
        title:      "Argument Tutor Feedback",
        summary:    "The claim is clear; the evidence is thin.",
        mode:       "analysis",
        criteria:   [
            { key: "claim", label: "Claim", score: 1, value: "In favor (1)" },
            { key: "evidence", label: "Evidence", score: 1, value: "1/3" },
            { key: "warrant", label: "Warrant", score: 2, value: "2/3" },
            { key: "qualifier", label: "Qualifier", score: 2, value: "2/3" },
        ],
        bullets:         ["State your evidence."],
        argumentPreview: ARGUMENT,
        comparison:      null,
        claimTypeId:     "AF2",
        tutorMode:       "enhanced",
        ...overrides,
    };
}

// What a student must never read: the evaluation's ids and the model's
// texts. Fragments quote the student's own argument, which the document
// shows in its text sections; they are checked apart (evaluationSections()).
function teacherOnlyStrings(argumentEvaluation) {
    const strings = new Set();
    const evaluations = argumentEvaluation.kind === "analysis"
        ? [argumentEvaluation.evaluation]
        : [argumentEvaluation.initial, argumentEvaluation.revised];
    for (const evaluation of evaluations) {
        const { claim, evidence, warrant, qualifier } = evaluation.criteria;
        for (const value of [
            claim.reason, claim.claimTypeId,
            warrant.reason, warrant.factId,
            qualifier.reason,
            ...evidence.factIds, ...evidence.exclusionIds,
            evaluation.rubricVersion, evaluation.calls.correction.promptVersion,
        ]) {
            if (typeof value === "string") {
                strings.add(value);
            }
        }
    }
    return [...strings];
}

function fragmentsOf(argumentEvaluation) {
    const evaluations = argumentEvaluation.kind === "analysis"
        ? [argumentEvaluation.evaluation]
        : [argumentEvaluation.initial, argumentEvaluation.revised];
    return evaluations.flatMap(evaluation => Object.values(evaluation.criteria)
        .map(criterion => criterion.fragment)
        .filter(Boolean));
}

function assertNoTeacherOnlyText(document, argumentEvaluation, label) {
    const json = JSON.stringify(document);
    for (const text of teacherOnlyStrings(argumentEvaluation)) {
        assert.equal(json.includes(text), false, `${label} does not carry ${JSON.stringify(text)}`);
    }
    assert.equal(/\b(?:AF|EV|EX)[1-9][0-9]*\b/u.test(json), false, `${label} shows no id`);

    // Only the student's own argument, in a text section, may hold a fragment.
    const evaluationSections = JSON.stringify(document.sections
        .filter(section => section.kind !== "text"));
    for (const fragment of fragmentsOf(argumentEvaluation)) {
        assert.equal(evaluationSections.includes(fragment), false, `${label} quotes no fragment`);
    }
}

function assertValidDocument(document, label) {
    const { problems } = validateStudentResultDocument("student-result/v1", document);
    assert.deepEqual(problems, [], label);
}

// A criteria item of the student's document: a level with its 0-based scale.
function criterion(key, label, value, score, maxScore) {
    return { key, label, value, score, minScore: 0, maxScore };
}

// A comparison item of the student's document whose level went up.
function change(key, label, before, after) {
    return { key, label, before, after, trend: "improved" };
}

function criteriaOf(document) {
    return document.sections.find(section => section.kind === "criteria").items;
}

// ─── Reading the evaluation ─────────────────────────────────────────────────

test("every contract example is read with the levels and scales it states", () => {
    for (const [name, document] of Object.entries(EXAMPLES)) {
        const read = argumentEvaluationOf(v19Payload(document));
        assert.equal(read.kind, document.kind, name);
        assert.equal(read.rubric, "v19", name);
        assert.equal(read.tutorMode, "enhanced", name);

        const pairs = document.kind === "analysis"
            ? [[read.evaluation, document.evaluation]]
            : [[read.initial, document.initial], [read.revised, document.revised]];
        for (const [evaluation, source] of pairs) {
            assert.equal(evaluation.rubricVersion, source.rubricVersion, name);
            for (const [key, criterion] of Object.entries(source.criteria)) {
                assert.deepEqual(
                    { level: evaluation.criteria[key].level, min:   evaluation.criteria[key].min,
                        max:   evaluation.criteria[key].max },
                    { level: criterion.level, ...criterion.scale },
                    `${name} ${key}`
                );
            }
        }
    }
});

test("a comparison is read with the differences it states", () => {
    const read = argumentEvaluationOf(v19Payload(EXAMPLES.comparison));

    assert.deepEqual(read.differences, {
        claim:     { levelChange: 1, claimTypeChanged: false, stanceChanged: false },
        evidence:  { levelChange: 1, factIdsGained: ["EV13", "EV19", "EV5"], factIdsLost: ["EV4"] },
        warrant:   { levelChange: 1 },
        qualifier: { levelChange: 1 },
    });
    assert.equal(currentEvaluation(read), read.revised);
});

test("the evaluation is found nested as the legacy keys are", () => {
    const nested = { payload: { feedback: v19Payload(EXAMPLES.analysis) } };

    assert.equal(argumentEvaluationOf(nested).kind, "analysis");
    assert.equal(tutorRubricOf(nested), "v19");
});

test("a v12 payload, another major version or a document without levels is not read", () => {
    assert.equal(argumentEvaluationOf(v12Payload()), null);
    assert.equal(tutorRubricOf(v12Payload()), null);
    assert.equal(argumentEvaluationOf(v19Payload({
        ...EXAMPLES.analysis, schemaVersion: "argument-evaluation/v2",
    })), null);
    assert.equal(argumentEvaluationOf(v19Payload({ schemaVersion: "argument-evaluation/v1" })), null);
    assert.equal(argumentEvaluationOf({ argumentEvaluation: "redacted" }), null);
    assert.equal(argumentEvaluationOf(null), null);
});

test("scales come from the payload, never from constants", () => {
    const document = structuredClone(EXAMPLES.analysis);
    document.evaluation.criteria.evidence.scale = { min: 0, max: 5 };
    document.evaluation.criteria.evidence.level = 4;
    const payload = v19Payload(document);

    const evidence = argumentEvaluationOf(payload).evaluation.criteria.evidence;
    assert.deepEqual([evidence.level, evidence.min, evidence.max], [4, 0, 5]);

    const studentEvidence = criteriaOf(mappedStudentDocument(payload, "es_CL").document)
        .find(item => item.key === "evidence");
    assert.deepEqual(studentEvidence,
        { key: "evidence", label: "Evidencia", value: "4 de 5", score: 4, minScore: 0, maxScore: 5 });

    const values = feedbackColumnValues(payload);
    assert.equal(values.ats_evidence_level, 4);
    assert.equal(values.ats_evidence_scale, "0-5");
});

test("a level outside its own scale is not read, and the others still are", () => {
    const document = structuredClone(EXAMPLES.analysis);
    document.evaluation.criteria.warrant.level = 3;
    const payload = v19Payload(document);

    const { criteria } = argumentEvaluationOf(payload).evaluation;
    assert.equal(criteria.warrant, null);
    assert.equal(criteria.claim.level, 2);

    const mapped = mappedStudentDocument(payload, "en_US").document;
    assert.equal(mapped.status, "partial");
    assert.deepEqual(criteriaOf(mapped).find(item => item.key === "warrant"),
        { key: "warrant", label: "Warrant", value: "Not available" });
    assertValidDocument(mapped, "partial document");
});

test("a forgotten student's redacted payload keeps its levels and loses its ids", () => {
    // V31 replaces every string with the placeholder and keeps the numbers.
    const redact = value => {
        if (typeof value === "string") {
            return value === "" ? value : "******";
        }
        if (Array.isArray(value)) {
            return value.map(redact);
        }
        if (value && typeof value === "object") {
            return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]));
        }
        return value;
    };
    const payload = redact(v19Payload(EXAMPLES.comparison));

    const read = argumentEvaluationOf(payload);
    assert.equal(read.kind, "comparison");
    assert.equal(read.rubric, null);
    assert.equal(read.revised.criteria.claim.level, 2);
    assert.equal(read.revised.criteria.claim.claimTypeId, null);
    assert.deepEqual(read.revised.criteria.evidence.factIds, []);

    const values = feedbackColumnValues(payload);
    assert.equal(values.ats_claim_level, 2);
    assert.equal(values.ats_claim_scale, "0-2");
    assert.equal(values.ats_evidence_facts, null);
    assertValidDocument(mappedStudentDocument(payload, "es_CL").document, "redacted document");
});

// ─── The student's document ─────────────────────────────────────────────────

test("a v19 analysis maps to the student's levels with their scales and the claim's stance", () => {
    const payload = v19Payload(EXAMPLES.analysis);

    const { document, source } = mappedStudentDocument(payload, "es_CL");
    assert.equal(source, "evaluation");
    assert.deepEqual(document, {
        schemaVersion: "student-result/v1",
        locale:        "es-CL",
        title:         "Retroalimentación sobre tu argumento",
        sections:      [
            {
                kind:  "criteria",
                title: "Criterios",
                items: [
                    criterion("claim", "Afirmación", "2 de 2 · En contra", 2, 2),
                    criterion("evidence", "Evidencia", "2 de 2", 2, 2),
                    criterion("warrant", "Garantía", "2 de 2", 2, 2),
                    criterion("qualifier", "Calificador", "Presente", 1, 1),
                ],
            },
            { kind: "text", title: "Tu argumento", text: ARGUMENT },
        ],
    });
    assertValidDocument(document, "analysis");
    assertNoTeacherOnlyText(document, EXAMPLES.analysis, "analysis document");
});

test("an analysis without a claim reads its levels without a stance, in English too", () => {
    const { document } = mappedStudentDocument(v19Payload(EXAMPLES.entryRule), "en_US");

    assert.equal(document.title, "Feedback on your argument");
    assert.deepEqual(criteriaOf(document).map(item => item.value),
        ["0 of 2", "2 of 2", "0 of 2", "Absent"]);
    assertValidDocument(document, "entry rule");
    assertNoTeacherOnlyText(document, EXAMPLES.entryRule, "entry-rule document");

    const noClaim = mappedStudentDocument(v19Payload(EXAMPLES.noClaim), "es_CL").document;
    assertValidDocument(noClaim, "no claim");
    assertNoTeacherOnlyText(noClaim, EXAMPLES.noClaim, "no-claim document");
});

test("a v19 comparison maps to the changes per criterion and the revised levels", () => {
    const payload = v19Payload(EXAMPLES.comparison, {
        comparison: { initialArgument: PREVIOUS_ARGUMENT, revisedArgument: ARGUMENT },
    });

    const { document } = mappedStudentDocument(payload, "es_CL");
    assert.equal(document.title, "Retroalimentación sobre tu argumento revisado");
    assert.deepEqual(document.sections[0], {
        kind:  "comparison",
        title: "Cambios respecto de tu argumento anterior",
        items: [
            change("claim", "Afirmación", "1 de 2 · En contra", "2 de 2 · En contra"),
            change("evidence", "Evidencia", "1 de 2", "2 de 2"),
            change("warrant", "Garantía", "1 de 2", "2 de 2"),
            change("qualifier", "Calificador", "Ausente", "Presente"),
        ],
    });
    assert.equal(document.sections[1].title, "Criterios de tu argumento revisado");
    assert.deepEqual(document.sections.slice(2), [
        { kind: "text", title: "Tu argumento anterior", text: PREVIOUS_ARGUMENT },
        { kind: "text", title: "Tu argumento revisado", text: ARGUMENT },
    ]);
    assertValidDocument(document, "comparison");
    assertNoTeacherOnlyText(document, EXAMPLES.comparison, "comparison document");
});

test("the tutor's own student document wins over the mapping", async () => {
    const tutorDocument = await readJson(new URL("tutor-analysis.es_CL.json", STUDENT_EXAMPLES_URL));
    const payload = v19Payload(EXAMPLES.analysis, { studentResult: tutorDocument });

    const { source, studentResult } = await buildStudentFeedback(payload, DESTINATION);
    assert.equal(source, "tutor");
    assert.deepEqual(studentResult.document, tutorDocument);
});

test("without the tutor's document, a v19 payload is published from its evaluation", async () => {
    const { source, studentResult } = await buildStudentFeedback(
        v19Payload(EXAMPLES.analysis), DESTINATION, { resolveLocale: async () => "en_US" }
    );

    assert.equal(source, "evaluation");
    assert.equal(studentResult.document.locale, "en-US");
    assert.equal(studentResult.message, "Feedback on your argument is now available.");
    assert.equal(studentResult.status, "completed");
});

test("a v12 payload is still mapped from its legacy keys", () => {
    const payload = v12Payload();
    assert.deepEqual(mappedStudentDocument(payload, "es_CL"),
        { document: legacyStudentDocument(payload, "es_CL"), source: "legacy" });
});

// ─── Teachers ───────────────────────────────────────────────────────────────

test("the callback outcome records the levels, claim type, stance and facts for teachers", async () => {
    const handlers = new Map();
    const published = [];
    await register({
        subscribe:               (hookName, handler) => handlers.set(hookName, handler),
        publishStudentResult:    async payload => { published.push(payload); return true; },
        atsFeedbackDependencies: {
            resolveGroupId:     async () => 7,
            loadActivityLocale: async () => "es_CL",
        },
    });
    const callbacks = [];
    await handlers.get("callback-received")({
        serviceId:      SERVICE_ID,
        requestPayload: v19Payload(EXAMPLES.analysis),
        ...DESTINATION,
        groupId:        7,
        jobId:          "job-1",
        resultId:       "result-1",
    }, { callback: async result => { callbacks.push(result); } });

    assert.equal(callbacks[0].status, "completed");
    const { payload } = callbacks[0];
    assert.deepEqual(payload.studentDocument, { source: "evaluation", locale: "es-CL" });
    assert.equal(payload.claimTypeId, "AF2");
    assert.equal(payload.claimTypeRationale, null);
    assert.equal(payload.tutorMode, "enhanced");
    assert.equal(payload.requestedMode, "enhanced");
    assert.deepEqual(payload.evidenceFactIds, ["EV13", "EV19", "EV5"]);
    assert.equal(payload.rubric, "v19");
    assert.deepEqual(payload.rubricEvaluation, {
        kind:          "analysis",
        rubric:        "v19",
        rubricVersion: "toulmin-coders/v1",
        levels:        {
            claim:     { level: 2, min: 0, max: 2 },
            evidence:  { level: 2, min: 0, max: 2 },
            warrant:   { level: 2, min: 0, max: 2 },
            qualifier: { level: 1, min: 0, max: 1 },
        },
        claimTypeId:      "AF2",
        stance:           "against",
        factIds:          ["EV13", "EV19", "EV5"],
        exclusionIds:     ["EX3"],
        notInCaseCount:   0,
        warrantFactId:    "EV13",
        entryRuleApplied: false,
    });
    // The record quotes neither the student nor the model.
    const record = JSON.stringify(payload.rubricEvaluation);
    for (const criterion of Object.values(EXAMPLES.analysis.evaluation.criteria)) {
        for (const text of [criterion.fragment, criterion.reason].filter(Boolean)) {
            assert.equal(record.includes(text), false);
        }
    }
    assertNoTeacherOnlyText(published[0].document, EXAMPLES.analysis, "published document");
});

test("a comparison's record keeps both evaluations and their differences", () => {
    const record = evaluationRecordOf(argumentEvaluationOf(v19Payload(EXAMPLES.comparison)));

    assert.equal(record.kind, "comparison");
    assert.deepEqual(record.initial.levels.evidence, { level: 1, min: 0, max: 2 });
    assert.deepEqual(record.revised.levels.evidence, { level: 2, min: 0, max: 2 });
    assert.deepEqual(record.revised.factIds, ["EV13", "EV19", "EV5"]);
    assert.equal(record.differences.qualifier.levelChange, 1);
});

test("a v12 callback outcome gains no rubric keys", () => {
    assert.deepEqual(rubricOutcomeOf(v12Payload()), {});
    assert.deepEqual(claimTypeFromExternalResult(v12Payload()),
        { claimTypeId: "AF2", claimTypeRationale: null });
    assert.deepEqual(tutorEvaluationFromExternalResult(v12Payload()), { tutorMode: "enhanced" });
});

test("a v19 comparison reports its mode and the revised claim type", () => {
    const payload = v19Payload(EXAMPLES.comparison);

    assert.deepEqual(tutorEvaluationFromExternalResult(payload), {
        tutorMode:       "enhanced",
        requestedMode:   "enhanced",
        evidenceFactIds: ["EV13", "EV19", "EV5"],
    });
    assert.deepEqual(claimTypeFromExternalResult(payload),
        { claimTypeId: "AF2", claimTypeRationale: null });
});

test("the feedback payload reads v19 levels with their scales and no ids", () => {
    const analysis = buildFeedbackPayloadFromExternalResult(v19Payload(EXAMPLES.analysis), {});
    assert.equal(analysis.mode, "analysis");
    assert.equal(analysis.rubric, "v19");
    assert.deepEqual(analysis.criteria[0], {
        key:      "claim",
        label:    "Claim",
        score:    2,
        minScore: 0,
        maxScore: 2,
        value:    "2 (0-2), against",
    });
    assert.deepEqual(analysis.criteria[3], {
        key: "qualifier", label: "Qualifier", score: 1, minScore: 0, maxScore: 1, value: "1 (0-1)",
    });

    const comparison = buildFeedbackPayloadFromExternalResult(v19Payload(EXAMPLES.comparison), {});
    assert.equal(comparison.mode, "comparison");
    assert.deepEqual(comparison.comparison.scores.evidence,
        { initial: 1, revised: 2, delta: 1, min: 0, max: 2 });
    assert.equal(/\b(?:AF|EV|EX)[1-9]/u.test(JSON.stringify([analysis, comparison])), false);
});

// ─── The report ─────────────────────────────────────────────────────────────

const REPORT_ROWS = Object.freeze([
    { responseId: 101, phaseId: PHASE_ID, questionId: QUESTION_ID, userId: STUDENT_ID, groupId: 7 },
    { responseId: 102, phaseId: PHASE_ID, questionId: QUESTION_ID, userId: 32, groupId: 7 },
]);

function storedResult(rawPayload, { responseId = 101, userId = STUDENT_ID } = {}) {
    return {
        id:            `result-${responseId}`,
        jobId:         `job-${responseId}`,
        hookName:      "student-response-submitted",
        status:        "completed",
        phaseId:       PHASE_ID,
        questionId:    QUESTION_ID,
        groupId:       7,
        userId,
        source:        { kind: "response", id: responseId },
        rawPayload,
        adapterResult: { status: "completed" },
        receivedAt:    "2026-11-16T10:00:00.000Z",
    };
}

async function contribute(stored) {
    return buildReportContribution(
        { reportType: "responses", serviceId: SERVICE_ID, sessionId: SESSION_ID, rows: REPORT_ROWS },
        { results: { list: async () => stored } }
    );
}

test("the report keeps the v12 columns and adds the v19 columns", () => {
    const ids = ATS_REPORT_COLUMNS.map(column => column.id);
    for (const id of ["ats_claim", "ats_evidence", "ats_warrant", "ats_qualifier",
        "ats_claim_type", "ats_unsupported_claims"]) {
        assert.ok(ids.includes(id), id);
    }
    for (const id of ["ats_rubric", "ats_rubric_version", "ats_claim_level", "ats_claim_scale",
        "ats_qualifier_level", "ats_qualifier_scale", "ats_claim_stance", "ats_evidence_facts",
        "ats_evidence_exclusions", "ats_entry_rule_applied", "ats_warrant_level_change"]) {
        assert.ok(ids.includes(id), id);
    }
});

test("a v19 analysis and a v12 analysis export side by side", async () => {
    const contribution = await contribute([
        storedResult(v19Payload(EXAMPLES.analysis)),
        storedResult(v12Payload({ userId: "32" }), { responseId: 102, userId: 32 }),
    ]);
    const values = new Map(contribution.values.map(entry => [entry.rowKey, entry.values]));

    assert.deepEqual(values.get(101), {
        ats_mode:                   "analysis",
        ats_tutor_mode:             "enhanced",
        ats_requested_mode:         "enhanced",
        ats_feedback_title:         null,
        ats_feedback_summary:       null,
        ats_feedback_bullets:       null,
        ats_claim:                  null,
        ats_evidence:               null,
        ats_warrant:                null,
        ats_qualifier:              null,
        ats_rubric:                 "v19",
        ats_rubric_version:         "toulmin-coders/v1",
        ats_claim_level:            2,
        ats_claim_scale:            "0-2",
        ats_evidence_level:         2,
        ats_evidence_scale:         "0-2",
        ats_warrant_level:          2,
        ats_warrant_scale:          "0-2",
        ats_qualifier_level:        1,
        ats_qualifier_scale:        "0-1",
        ats_claim_stance:           "against",
        ats_evidence_facts:         "EV13, EV19, EV5",
        ats_evidence_exclusions:    "EX3",
        ats_entry_rule_applied:     false,
        ats_claim_level_change:     null,
        ats_evidence_level_change:  null,
        ats_warrant_level_change:   null,
        ats_qualifier_level_change: null,
        ats_claim_type:             "AF2",
        ats_unsupported_claims:     null,
        ats_feedback_count:         1,
        ats_feedback_time:          "2026-11-16T10:00:00.000Z",
    });

    // The v12 row has its v12 values and none of the v19 columns.
    const v12 = values.get(102);
    assert.deepEqual([v12.ats_claim, v12.ats_evidence, v12.ats_warrant, v12.ats_qualifier],
        [1, 1, 2, 2]);
    assert.equal(Object.keys(v12).some(key => key === "ats_rubric" || key.endsWith("_level")),
        false);

    const validation = validateReportContribution(contribution, {
        reportType:        "responses",
        rowKeys:           new Map(REPORT_ROWS.map(row => [String(row.responseId), row.responseId])),
        columnPrefix:      "ats_",
        reservedColumnIds: new Set(["comment"]),
    });
    assert.equal(validation.valid, true, validation.problems.join("\n"));
    assertNoArgumentText(contribution, EXAMPLES.analysis);
});

test("a v19 revision exports the revised levels and the level changes", async () => {
    const contribution = await contribute([storedResult(v19Payload(EXAMPLES.comparison))]);
    const values = contribution.values[0].values;

    assert.equal(values.ats_mode, "comparison");
    assert.deepEqual(
        ["claim", "evidence", "warrant", "qualifier"].map(key => values[`ats_${key}_level`]),
        [2, 2, 2, 1]
    );
    assert.deepEqual(
        ["claim", "evidence", "warrant", "qualifier"].map(key => values[`ats_${key}_level_change`]),
        [1, 1, 1, 1]
    );
    assert.equal(values.ats_claim_type, "AF2");
    assert.equal(values.ats_evidence_facts, "EV13, EV19, EV5");
    assertNoArgumentText(contribution, EXAMPLES.comparison);
});

function assertNoArgumentText(contribution, argumentEvaluation) {
    const json = JSON.stringify(contribution.values);
    assert.equal(json.includes(ARGUMENT), false, "the report does not quote the argument");
    const evaluations = argumentEvaluation.kind === "analysis"
        ? [argumentEvaluation.evaluation]
        : [argumentEvaluation.initial, argumentEvaluation.revised];
    for (const evaluation of evaluations) {
        for (const criterion of Object.values(evaluation.criteria)) {
            for (const text of [criterion.fragment, criterion.reason].filter(Boolean)) {
                assert.equal(json.includes(text), false, "the report does not quote the evaluation");
            }
        }
    }
}

// ─── The rebuild ────────────────────────────────────────────────────────────

test("a v19 result rebuilt for the student equals the one published live", async () => {
    const payload = v19Payload(EXAMPLES.comparison);
    const live = await buildStudentFeedback(payload, DESTINATION, {
        resolveLocale: async () => "es_CL",
    });
    const stored = {
        ...storedResult(JSON.parse(JSON.stringify(payload))),
        adapterResult: {
            status:  "completed",
            payload: {
                publishedToUserId: STUDENT_ID,
                studentDocument:   { source: "evaluation", locale: "es-CL" },
            },
        },
    };

    const [rebuilt] = await readStudentResults(
        { serviceId: SERVICE_ID, sessionId: SESSION_ID, userId: STUDENT_ID, locale: "en_US" },
        { results: { list: async () => [stored] } }
    );
    assert.deepEqual(rebuilt.payload, live.studentResult.document);
});

// ─── The rubric a design chooses ────────────────────────────────────────────

const METADATA = Object.freeze({
    caseId: 51, caseTitle: "Caso Sebastián", caseText: "Case text.", question: "¿Qué harías?",
});

test("a session is opened with the rubric the phase stores, and without one otherwise", () => {
    assert.equal(buildAtsSessionPayload(METADATA, { evaluation_rubric: "v12" }).evaluation_rubric,
        "v12");
    for (const configuration of [{}, { evaluation_rubric: "  " }, { llm_tier: "basic" }]) {
        assert.equal(
            Object.hasOwn(buildAtsSessionPayload(METADATA, configuration), "evaluation_rubric"),
            false, JSON.stringify(configuration)
        );
    }
});

test("the session's rubric is recorded when the tutor reports it", async () => {
    const created = await createAtsSession({
        metadata:             METADATA,
        serviceConfiguration: { evaluation_rubric: "v12" },
        request:              async () => ({ session_id: "ats-1", rubric: "v12", warnings: [] }),
    });

    assert.equal(created.creation.rubric, "v12");
});

test("a rejected rubric is dropped with the other settings and the session created", async () => {
    const bodies = [];
    const rejection = { error: "Invalid instance configuration", errors: { evaluation_rubric: "x" } };
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
        const created = await createAtsSession({
            metadata:             METADATA,
            serviceConfiguration: { evaluation_rubric: "v3" },
            request:              async body => {
                bodies.push(body);
                if (bodies.length === 1) {
                    throw Object.assign(new Error("HTTP 400"),
                        { statusCode: 400, responseBody: rejection });
                }
                return { session_id: "ats-2", rubric: "v19", warnings: [] };
            },
        });

        assert.equal(bodies[0].evaluation_rubric, "v3");
        assert.equal(Object.hasOwn(bodies[1], "evaluation_rubric"), false);
        assert.equal(created.creation.configurationRejected, true);
        assert.equal(created.creation.rubric, "v19");
    } finally {
        console.warn = originalWarn;
    }
});
