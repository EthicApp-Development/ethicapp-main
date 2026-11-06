// The tutor's feedback as a student-result/v1 document (epic #1124, #1133):
// the tutor's `studentResult` is forwarded unchanged, a callback without one
// is mapped from its legacy keys in the activity's locale, and no
// teacher-only key reaches the document. Every document is checked with the
// validator the registry uses (services/student-result-documents.js).
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
    activityLocale,
    buildAtsSessionPayload,
    buildStudentFeedback,
    documentLocaleOf,
    legacyStudentDocument,
    tutorStudentDocument,
} from "../ats-feedback.utils.js";
import {
    checkStudentResultDocument,
    DECLARATION_STATUS,
    STUDENT_RESULT_SCOPE,
    validateStudentResultDocument,
} from "../../../services/student-result-documents.js";

const EXAMPLES_URL = new URL(
    "../../../../../canonical-schemas/ai-additions/examples/student-result.v1/", import.meta.url
);

async function example(name) {
    return JSON.parse(await fs.readFile(new URL(`${name}.json`, EXAMPLES_URL), "utf8"));
}

const TUTOR_EXAMPLES = Object.freeze([
    "tutor-analysis.es_CL",
    "tutor-analysis.en_US",
    "tutor-comparison.es_CL",
    "tutor-comparison.en_US",
]);

const DESTINATION = Object.freeze({ sessionId: 5, phaseId: 20, questionId: 101, userId: 31 });

// The keys the tutor sends for teachers only (#850, #865, #870).
const TEACHER_KEYS = Object.freeze([
    "claimTypeId", "claimTypeRationale", "tutorMode", "requestedMode",
    "evidenceFactIds", "unsupportedClaims",
]);

const TEACHER_VALUES = Object.freeze({
    claimTypeId:        "AF2",
    claimTypeRationale: "Argues for disclosure.",
    tutorMode:          "enhanced",
    requestedMode:      "enhanced",
    evidenceFactIds:    ["EV1"],
    unsupportedClaims:  [{ statement: "The CEO knew.", exclusionId: "EX1" }],
});

// The tutor's argument-feedback output, as the descriptor service
// normalizes it.
const DECLARATION = Object.freeze({
    status:         DECLARATION_STATUS.KNOWN,
    studentOutputs: [{
        id:             "argument-feedback",
        documentSchema: "student-result/v1",
        scopes:         [STUDENT_RESULT_SCOPE],
    }],
});

// A document the registry would publish: valid against the schema copy and
// declared by the tutor for the response scope.
function assertPublishable(document, label) {
    const validation = validateStudentResultDocument("student-result/v1", document);
    assert.deepEqual(validation.problems, [], label);
    const check = checkStudentResultDocument({
        documentSchema:   "student-result/v1",
        document,
        scope:            STUDENT_RESULT_SCOPE,
        declaration:      DECLARATION,
        validateDocument: validateStudentResultDocument,
    });
    assert.deepEqual(check.problems, [], label);
}

// Every key of every object in `value`, at any depth.
function allKeys(value, keys = new Set()) {
    if (Array.isArray(value)) {
        value.forEach(item => allKeys(item, keys));
    } else if (value !== null && typeof value === "object") {
        for (const [key, nested] of Object.entries(value)) {
            keys.add(key);
            allKeys(nested, keys);
        }
    }
    return keys;
}

function assertNoTeacherKey(value, label) {
    const keys = allKeys(value);
    for (const key of TEACHER_KEYS) {
        assert.equal(keys.has(key), false, `${label}: ${key}`);
    }
}

// An example without what the mapping cannot know: the overview and the
// criterion descriptions.
function withoutHelp(document) {
    const copy = structuredClone(document);
    delete copy.overview;
    for (const section of copy.sections) {
        for (const item of section.items ?? []) {
            if (item && typeof item === "object") {
                delete item.description;
            }
        }
    }
    return copy;
}

function sectionOf(document, kind) {
    return document.sections.filter(section => section.kind === kind);
}

const CLAIM_SCORES = new Map([
    ["A favor", 1], ["In favor", 1],
    ["En contra", -1], ["Against", -1],
    ["Sin postura clara", 0], ["No clear position", 0],
]);

// The score a criterion value of the tutor's document stands for.
function scoreOf(key, value, score) {
    return key === "claim" ? CLAIM_SCORES.get(value) : score;
}

/**
 * The legacy keys the tutor sends next to a document
 * (`build_ats_callback_payload` in ethicapp-ai-additions), for the
 * evaluation an example documents: English labels and values, the scores of
 * the (revised) argument, the model's summary and bullets, and the student's
 * argument.
 */
function legacyPayloadOf(document) {
    const [criteria] = sectionOf(document, "criteria");
    const [comparison] = sectionOf(document, "comparison");
    const [bullets] = sectionOf(document, "bullets");
    const texts = sectionOf(document, "text").map(section => section.text);
    const scores = Object.fromEntries(criteria.items
        .map(item => [item.key, scoreOf(item.key, item.value, item.score)]));

    const payload = {
        ...DESTINATION,
        userId:   String(DESTINATION.userId),
        groupId:  7,
        taskId:   "task-1",
        title:    "Argument Tutor Feedback",
        summary:  document.summary ?? "Argument feedback is now available.",
        mode:     comparison ? "comparison" : "analysis",
        criteria: criteria.items.map(item => ({
            key:   item.key,
            label: item.key[0].toUpperCase() + item.key.slice(1),
            score: scores[item.key],
            value: `${scores[item.key]}/3`,
        })),
        bullets:         bullets ? [...bullets.items] : [document.summary],
        argumentPreview: texts.at(-1),
        comparison:      null,
    };
    if (comparison) {
        const before = Object.fromEntries(comparison.items.map(item => [
            item.key,
            scoreOf(item.key, item.before, Number.parseInt(item.before, 10)),
        ]));
        payload.comparison = {
            initialArgument: texts[0],
            revisedArgument: texts[1],
            scores:          Object.fromEntries(Object.keys(scores).map(key => [key, {
                initial: before[key],
                revised: scores[key],
                delta:   scores[key] - before[key],
            }])),
        };
    }
    return payload;
}

// The callback payload of a tutor without `studentResult`, as EthicApp's
// earlier tests sent it: English labels, a qualifier of 0 (outside the
// tutor's 1..3 scale) and the teacher-only keys.
function olderTutorPayload(overrides = {}) {
    return {
        ...DESTINATION,
        title:    "Argument Tutor Feedback",
        summary:  "The claim is clear; the evidence is thin.",
        mode:     "analysis",
        criteria: [
            { key: "claim", label: "Claim", score: 1, value: "In favor (1)" },
            { key: "evidence", label: "Evidence", score: 1, value: "1/3" },
            { key: "warrant", label: "Warrant", score: 2, value: "2/3" },
            { key: "qualifier", label: "Qualifier", score: 0, value: "0/3" },
        ],
        bullets:         ["State your evidence.", "Link it to the claim."],
        argumentPreview: "The company should disclose the defect.",
        comparison:      null,
        ...TEACHER_VALUES,
        ...overrides,
    };
}

// ─── The activity's locale ──────────────────────────────────────────────────

test("activityLocale follows the canonical rule over designs.language_code", () => {
    for (const [code, locale] of [
        ["es_CL", "es_CL"], ["es_AR", "es_CL"], ["es-MX", "es_CL"], ["es", "es_CL"],
        ["en_US", "en_US"], ["en_GB", "en_US"], ["pt_BR", "en_US"],
        [null, "es_CL"], [undefined, "es_CL"], ["  ", "es_CL"],
    ]) {
        assert.equal(activityLocale(code), locale, String(code));
    }
});

test("documentLocaleOf names a locale as student-result/v1 does", () => {
    for (const [locale, tag] of [
        ["es_CL", "es-CL"], ["en_US", "en-US"], ["en-US", "en-US"], ["ES_cl", "es-CL"],
        ["es_AR", null], ["pt-BR", null], [null, null], [3, null],
    ]) {
        assert.equal(documentLocaleOf(locale), tag, String(locale));
    }
});

test("buildAtsSessionPayload sends the locale as a session input", () => {
    const metadata = { caseId: 1, caseTitle: "T", caseText: "C", question: "Q" };

    assert.equal(buildAtsSessionPayload(metadata, {}, null, null, "en_US").locale, "en_US");
    assert.equal(Object.hasOwn(buildAtsSessionPayload(metadata, {}, null, null, null), "locale"),
        false);
    assert.equal(Object.hasOwn(buildAtsSessionPayload(metadata), "locale"), false);
});

// ─── The tutor's document ───────────────────────────────────────────────────

test("the tutor's document is forwarded unchanged, without reading the locale", async () => {
    for (const name of TUTOR_EXAMPLES) {
        const document = await example(name);
        const payload = {
            ...legacyPayloadOf(document),
            ...TEACHER_VALUES,
            studentResult: document,
        };

        const built = await buildStudentFeedback(payload, DESTINATION, {
            resolveLocale: async () => assert.fail("a tutor document needs no locale"),
        });

        assert.equal(built.source, "tutor", name);
        assert.equal(built.tutorDocumentProblems, null, name);
        assert.equal(built.studentResult.document, document, `${name}: the same object`);
        assert.deepEqual(built.studentResult.document, await example(name), `${name}: unchanged`);
        assert.deepEqual(Object.keys(built.studentResult).sort(),
            ["document", "documentSchema", "message", "phaseId", "questionId", "status"]);
        assert.equal(built.studentResult.documentSchema, "student-result/v1");
        assert.equal(built.studentResult.phaseId, DESTINATION.phaseId);
        assert.equal(built.studentResult.questionId, DESTINATION.questionId);
        assert.equal(built.studentResult.status, "completed");
        assert.match(built.studentResult.message,
            document.locale === "es-CL" ? /retroalimentación/u : /Feedback/u, name);
        assertNoTeacherKey(built.studentResult, name);
        assertPublishable(built.studentResult.document, name);
    }
});

test("a nested studentResult is read where the legacy keys are", async () => {
    const document = await example("tutor-analysis.en_US");

    for (const payload of [
        { payload: { feedback: { studentResult: document } } },
        { payload: { studentResult: document } },
    ]) {
        assert.equal(tutorStudentDocument(payload).document, document);
    }
});

test("a tutor document that fails EthicApp's checks gives way to the legacy keys", async () => {
    const document = await example("tutor-analysis.en_US");
    const cases = [
        ["a teacher-only key", { ...document, claimTypeId: "AF2" }, "claimTypeId"],
        ["an unknown locale", { ...document, locale: "pt-BR" }, "locale"],
        ["no sections", { ...document, sections: undefined }, "<root>"],
        ["not an object", "feedback", "<root>"],
    ];

    for (const [name, studentResult, path] of cases) {
        const built = await buildStudentFeedback(
            { ...legacyPayloadOf(document), ...TEACHER_VALUES, studentResult },
            DESTINATION,
            { resolveLocale: async () => "en_US" }
        );

        assert.equal(built.source, "legacy", name);
        assert.ok(built.tutorDocumentProblems.some(problem => problem.path === path),
            `${name}: ${JSON.stringify(built.tutorDocumentProblems)}`);
        assert.deepEqual(built.studentResult.document, withoutHelp(document), name);
        assertNoTeacherKey(built.studentResult, name);
        assertPublishable(built.studentResult.document, name);
    }
});

// ─── The legacy mapping ─────────────────────────────────────────────────────

test("a legacy payload maps to the tutor's document without descriptions or overview", async () => {
    for (const name of TUTOR_EXAMPLES) {
        const document = await example(name);
        const locale = name.endsWith("es_CL") ? "es_CL" : "en_US";

        const mapped = legacyStudentDocument(legacyPayloadOf(document), locale);

        assert.deepEqual(mapped, withoutHelp(document), name);
        assert.equal(Object.hasOwn(mapped, "overview"), false, name);
        assert.ok(mapped.sections.every(section => (section.items ?? [])
            .every(item => typeof item !== "object" || !Object.hasOwn(item, "description"))), name);
        assertPublishable(mapped, name);
    }
});

test("an older tutor's analysis is labelled in the activity's locale", async () => {
    const expected = {
        es_CL: {
            title:  "Retroalimentación sobre tu argumento",
            labels: ["Afirmación", "Evidencia", "Garantía", "Calificador"],
            values: ["A favor", "1 de 3", "2 de 3", "No disponible"],
            titles: ["Criterios", "Comentarios", "Tu argumento"],
        },
        en_US: {
            title:  "Feedback on your argument",
            labels: ["Claim", "Evidence", "Warrant", "Qualifier"],
            values: ["In favor", "1 of 3", "2 of 3", "Not available"],
            titles: ["Criteria", "Comments", "Your argument"],
        },
    };

    for (const [locale, texts] of Object.entries(expected)) {
        const built = await buildStudentFeedback(olderTutorPayload(), DESTINATION, {
            resolveLocale: async () => locale,
        });
        const { document } = built.studentResult;

        assert.equal(built.source, "legacy");
        assert.equal(built.tutorDocumentProblems, null);
        assert.equal(document.locale, locale.replace("_", "-"));
        assert.equal(document.title, texts.title);
        // The model's summary and bullets, as the tutor wrote them.
        assert.equal(document.summary, "The claim is clear; the evidence is thin.");
        assert.deepEqual(document.sections.map(section => section.title), texts.titles);
        const [criteria] = sectionOf(document, "criteria");
        assert.deepEqual(criteria.items.map(item => item.label), texts.labels, locale);
        assert.deepEqual(criteria.items.map(item => item.value), texts.values, locale);
        assert.deepEqual(criteria.items.map(item => item.score ?? null), [null, 1, 2, null]);
        // The qualifier's 0 is outside the scale.
        assert.equal(document.status, "partial");
        assert.deepEqual(sectionOf(document, "bullets")[0].items,
            ["State your evidence.", "Link it to the claim."]);
        assert.equal(sectionOf(document, "text")[0].text,
            "The company should disclose the defect.");
        assert.equal(Object.hasOwn(document, "overview"), false);
        assertNoTeacherKey(built.studentResult, locale);
        assertPublishable(document, locale);
    }
});

test("a legacy payload without a known locale is mapped in es-CL", async () => {
    for (const locale of [null, undefined, "pt_BR"]) {
        const built = await buildStudentFeedback(olderTutorPayload(), DESTINATION, {
            resolveLocale: async () => locale,
        });
        assert.equal(built.studentResult.document.locale, "es-CL", String(locale));
    }
    const withoutResolver = await buildStudentFeedback(olderTutorPayload(), DESTINATION);
    assert.equal(withoutResolver.studentResult.document.locale, "es-CL");
});

test("the placeholder summary and bullets that repeat the summary are left out", () => {
    const placeholder = legacyStudentDocument(olderTutorPayload({
        summary: "Argument feedback is now available.",
        bullets: ["Argument feedback is now available."],
    }), "es_CL");
    assert.equal(Object.hasOwn(placeholder, "summary"), false);
    assert.deepEqual(sectionOf(placeholder, "bullets"), []);
    assertPublishable(placeholder, "placeholder");

    // A tutor without bullets sends its summary as the only bullet.
    const repeated = legacyStudentDocument(olderTutorPayload({
        summary: "Your revision adds evidence.",
        bullets: ["Your revision adds evidence."],
    }), "en_US");
    assert.equal(repeated.summary, "Your revision adds evidence.");
    assert.deepEqual(sectionOf(repeated, "bullets"), []);
    assertPublishable(repeated, "repeated");
});

test("a legacy payload without criteria or comparison is unavailable", () => {
    // What the tutor sends when it cannot read the model's answer.
    const unreadable = {
        ...DESTINATION,
        title:           "Argument Tutor Feedback",
        summary:         "Argument feedback is now available.",
        mode:            "analysis",
        criteria:        [],
        bullets:         [],
        argumentPreview: "My argument.",
        comparison:      null,
    };

    assert.deepEqual(legacyStudentDocument(unreadable, "en_US"), {
        schemaVersion: "student-result/v1",
        locale:        "en-US",
        title:         "Feedback on your argument",
        summary:       "We could not prepare feedback on your argument.",
        status:        "unavailable",
        sections:      [{ kind: "text", title: "Your argument", text: "My argument." }],
    });
    for (const payload of [unreadable, { ...unreadable, argumentPreview: "" }, {}, null]) {
        const document = legacyStudentDocument(payload, "es_CL");
        assert.equal(document.status, "unavailable");
        assert.equal(document.summary, "No pudimos preparar la retroalimentación de tu argumento.");
        assertPublishable(document, JSON.stringify(payload));
    }
});

test("a legacy comparison with missing scores is partial and stays valid", () => {
    const document = legacyStudentDocument(olderTutorPayload({
        mode:       "comparison",
        criteria:   [{ key: "claim", score: -1 }, { key: "evidence", score: 3 }],
        comparison: {
            initialArgument: "Before.",
            revisedArgument: "After.",
            scores:          {
                claim:    { initial: 1, revised: -1, delta: -2 },
                evidence: { initial: 1, revised: 3, delta: 2 },
            },
        },
        argumentPreview: "",
    }), "en_US");

    assert.equal(document.title, "Feedback on your revised argument");
    assert.equal(document.status, "partial");
    assert.deepEqual(sectionOf(document, "comparison")[0].items, [
        { key: "claim", label: "Claim", before: "In favor", after: "Against" },
        {
            key:    "evidence",
            label:  "Evidence",
            before: "1 of 3",
            after:  "3 of 3",
            trend:  "improved",
        },
        { key: "warrant", label: "Warrant", before: "Not available", after: "Not available" },
        { key: "qualifier", label: "Qualifier", before: "Not available", after: "Not available" },
    ]);
    assert.deepEqual(sectionOf(document, "text").map(section => [section.title, section.text]),
        [["Your previous argument", "Before."], ["Your revised argument", "After."]]);
    assertPublishable(document, "comparison");
});

test("legacy texts are cut to the schema's limits", () => {
    const document = legacyStudentDocument(olderTutorPayload({
        summary:         "s".repeat(3000),
        bullets:         Array.from({ length: 8 }, (_, index) => `${index}`.repeat(1500)),
        argumentPreview: "a".repeat(12000),
    }), "en_US");

    assert.equal(document.summary.length, 2000);
    assert.ok(document.summary.endsWith("…"));
    const [bullets] = sectionOf(document, "bullets");
    assert.equal(bullets.items.length, 5);
    assert.ok(bullets.items.every(item => item.length === 1000));
    assert.equal(sectionOf(document, "text")[0].text.length, 10000);
    assertPublishable(document, "long");
});

test("a nested legacy feedback object is mapped too", () => {
    const nested = legacyStudentDocument(
        { ...DESTINATION, payload: { feedback: olderTutorPayload() } }, "en_US"
    );

    assert.deepEqual(nested, legacyStudentDocument(olderTutorPayload(), "en_US"));
});
