// Validation of student result documents (epic #1124, #1131): the schema copy
// in canonical-schemas/ai-additions/, the two integrity rules of
// ethicapp-ai-additions' validate_student_result(), and the declaration check.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
    checkStudentResultDocument,
    createDocumentValidator,
    DECLARATION_STATUS,
    declaresDocumentSchema,
    knownDocumentSchemas,
    loggableDocumentSchema,
    ROOT_PATH,
    STUDENT_RESULT_DOCUMENT_SCHEMA,
    STUDENT_RESULT_SCOPE,
    studentResultIntegrityProblems,
    validateStudentResultDocument,
} from "../student-result-documents.js";

// The copy and its examples, at the same path relative to this file in the
// repository and in the Docker test stage (/canonical-schemas).
const EXAMPLES_URL = new URL(
    "../../../../canonical-schemas/ai-additions/examples/student-result.v1/",
    import.meta.url
);

// Student text that must never appear in a problem.
const PRIVATE_MARKER = "private student argument 1131";

function minimalDocument(overrides = {}) {
    return {
        schemaVersion: STUDENT_RESULT_DOCUMENT_SCHEMA,
        locale:        "en-US",
        title:         "Feedback on your argument",
        sections:      [{ kind: "text", text: PRIVATE_MARKER }],
        ...overrides,
    };
}

function criteriaDocument(...items) {
    return minimalDocument({
        sections: [{ kind: "criteria", title: "Criteria", items }],
    });
}

function criterion(key, extra = {}) {
    return { key, label: "Evidence", value: "2 of 3", ...extra };
}

const DECLARED = Object.freeze({
    status:         DECLARATION_STATUS.KNOWN,
    studentOutputs: [{
        id:             "argument-feedback",
        documentSchema: STUDENT_RESULT_DOCUMENT_SCHEMA,
        scopes:         ["response"],
        label:          "Argument feedback",
        description:    "Feedback on each argument.",
    }],
});

function codes(problems) {
    return problems.map(problem => problem.code);
}

// ─── The schema copy ─────────────────────────────────────────────────────────

test("every example of the copy validates", () => {
    const names = readdirSync(EXAMPLES_URL).filter(name => name.endsWith(".json"));
    assert.ok(names.length > 0);
    for (const name of names) {
        const document = JSON.parse(readFileSync(new URL(name, EXAMPLES_URL), "utf8"));
        assert.deepEqual(validateStudentResultDocument(STUDENT_RESULT_DOCUMENT_SCHEMA, document),
            { valid: true, problems: [] }, name);
    }
});

test("student-result/v1 is the one known schema, and any other is refused", () => {
    assert.deepEqual(knownDocumentSchemas(), ["student-result/v1"]);

    for (const documentSchema of ["student-result/v2", "argument-report/v1", "", null, 1]) {
        assert.deepEqual(validateStudentResultDocument(documentSchema, minimalDocument()), {
            valid:    false,
            problems: [{ code: "unknown_document_schema", path: ROOT_PATH }],
        }, String(documentSchema));
    }
});

test("a schema violation names its keyword and path, never a value", () => {
    const document = minimalDocument({
        claimTypeId: PRIVATE_MARKER,
        sections:    [
            { kind: "criteria", items: [criterion("Not A Key", { value: `${PRIVATE_MARKER}\nsecond line` })] },
            { kind: "text" },
        ],
    });

    const { valid, problems } = validateStudentResultDocument(STUDENT_RESULT_DOCUMENT_SCHEMA, document);

    assert.equal(valid, false);
    assert.deepEqual(problems, [
        { code: "schema_violation", keyword: "pattern", path: "sections[0].items[0].key" },
        { code: "schema_violation", keyword: "not", path: "sections[0].items[0].value" },
        { code: "schema_violation", keyword: "required", path: "sections[1]" },
        { code: "schema_violation", keyword: "not_allowed", path: "claimTypeId" },
    ]);
    assert.doesNotMatch(JSON.stringify(problems), /private student/u);
});

test("a document that is not an object is refused at its root", () => {
    for (const document of [null, "text", [], 3]) {
        const { valid, problems } = validateStudentResultDocument(STUDENT_RESULT_DOCUMENT_SCHEMA, document);
        assert.equal(valid, false);
        assert.ok(problems.length > 0);
        assert.ok(problems.every(problem => problem.code === "schema_violation"));
    }
});

test("a section of an unknown kind is accepted, as the schema extension point", () => {
    const document = minimalDocument({
        sections: [{ kind: "rubric-grid", rows: [PRIVATE_MARKER] }, { kind: "text", text: "Kept." }],
    });
    assert.deepEqual(validateStudentResultDocument(STUDENT_RESULT_DOCUMENT_SCHEMA, document),
        { valid: true, problems: [] });
});

// ─── Integrity rules (validate_student_result) ───────────────────────────────

test("duplicate_criterion_key: a key repeated within one criteria section", () => {
    const document = criteriaDocument(criterion("evidence"), criterion("claim"), criterion("evidence"));

    assert.deepEqual(validateStudentResultDocument(STUDENT_RESULT_DOCUMENT_SCHEMA, document), {
        valid:    false,
        problems: [{ code: "duplicate_criterion_key", path: "sections[0].items[2].key" }],
    });

    // The same key in two sections is fine.
    const twoSections = minimalDocument({
        sections: [
            { kind: "criteria", items: [criterion("evidence")] },
            { kind: "criteria", items: [criterion("evidence")] },
        ],
    });
    assert.deepEqual(validateStudentResultDocument(STUDENT_RESULT_DOCUMENT_SCHEMA, twoSections),
        { valid: true, problems: [] });
});

test("score_out_of_range: minScore (0 by default) < maxScore and minScore <= score <= maxScore", () => {
    const cases = [
        [{ score: 2, minScore: 1, maxScore: 3 }, []],
        [{ score: 0, maxScore: 3 }, []],
        [{ score: 3, maxScore: 3 }, []],
        [{ score: 4, maxScore: 3 }, [{ code: "score_out_of_range", path: "sections[0].items[0].score" }]],
        [{ score: -1, maxScore: 3 }, [{ code: "score_out_of_range", path: "sections[0].items[0].score" }]],
        [{ score: 0, minScore: 1, maxScore: 3 }, [{ code: "score_out_of_range", path: "sections[0].items[0].score" }]],
        [{ score: 3, minScore: 3, maxScore: 3 }, [{ code: "score_out_of_range", path: "sections[0].items[0].maxScore" }]],
        [{ score: 0, maxScore: 0 }, [{ code: "score_out_of_range", path: "sections[0].items[0].maxScore" }]],
        [{ score: 5 }, []],
    ];

    for (const [scores, expected] of cases) {
        const result = validateStudentResultDocument(STUDENT_RESULT_DOCUMENT_SCHEMA,
            criteriaDocument(criterion("evidence", scores)));
        assert.deepEqual(result, { valid: expected.length === 0, problems: expected }, JSON.stringify(scores));
    }
});

test("the integrity rules skip what the schema already refuses, without throwing", () => {
    for (const document of [null, {}, { sections: "x" }, { sections: [null, { kind: "criteria" }] },
        { sections: [{ kind: "criteria", items: [null, { key: 1, maxScore: "3", score: 9 }] }] }]) {
        assert.deepEqual(studentResultIntegrityProblems(document), []);
    }
});

// ─── The declaration ─────────────────────────────────────────────────────────

test("publishStudentResult documents are checked in the response scope", () => {
    assert.equal(STUDENT_RESULT_SCOPE, "response");
});

test("declaresDocumentSchema matches the schema and the scope", () => {
    const outputs = DECLARED.studentOutputs;
    assert.equal(declaresDocumentSchema(outputs, "student-result/v1", "response"), true);
    assert.equal(declaresDocumentSchema(outputs, "student-result/v1", "chat"), false);
    assert.equal(declaresDocumentSchema(outputs, "student-result/v2", "response"), false);
    assert.equal(declaresDocumentSchema([], "student-result/v1", "response"), false);
    assert.equal(declaresDocumentSchema(null, "student-result/v1", "response"), false);
});

test("checkStudentResultDocument accepts a valid document of a declared schema", () => {
    assert.deepEqual(checkStudentResultDocument({
        documentSchema:   STUDENT_RESULT_DOCUMENT_SCHEMA,
        document:         minimalDocument(),
        scope:            "response",
        declaration:      DECLARED,
        validateDocument: validateStudentResultDocument,
    }), { ok: true, problems: [] });
});

test("checkStudentResultDocument refuses a valid document the service did not declare", () => {
    const declarations = [
        { status: DECLARATION_STATUS.KNOWN, studentOutputs: [] },
        {
            status:         DECLARATION_STATUS.KNOWN,
            studentOutputs: [{ ...DECLARED.studentOutputs[0], scopes: ["chat"] }],
        },
        { status: DECLARATION_STATUS.NO_DESCRIPTOR },
    ];

    for (const declaration of declarations) {
        assert.deepEqual(checkStudentResultDocument({
            documentSchema:   STUDENT_RESULT_DOCUMENT_SCHEMA,
            document:         minimalDocument(),
            scope:            "response",
            declaration,
            validateDocument: validateStudentResultDocument,
        }), {
            ok:       false,
            problems: [{ code: "undeclared_document_schema", path: ROOT_PATH }],
        }, JSON.stringify(declaration));
    }
});

test("checkStudentResultDocument refuses a document when the declaration is unknown", () => {
    for (const declaration of [{ status: DECLARATION_STATUS.UNAVAILABLE }, undefined]) {
        assert.deepEqual(checkStudentResultDocument({
            documentSchema:   STUDENT_RESULT_DOCUMENT_SCHEMA,
            document:         minimalDocument(),
            scope:            "response",
            declaration,
            validateDocument: validateStudentResultDocument,
        }).problems, [{ code: "declaration_unavailable", path: ROOT_PATH }]);
    }
});

test("checkStudentResultDocument reports the declaration and the document problems together", () => {
    const result = checkStudentResultDocument({
        documentSchema:   STUDENT_RESULT_DOCUMENT_SCHEMA,
        document:         criteriaDocument(criterion("evidence"), criterion("evidence")),
        scope:            "chat",
        declaration:      DECLARED,
        validateDocument: validateStudentResultDocument,
    });
    assert.equal(result.ok, false);
    assert.deepEqual(codes(result.problems), ["undeclared_document_schema", "duplicate_criterion_key"]);
});

// ─── Loading the copy ────────────────────────────────────────────────────────

test("a copy that cannot be read refuses every document of its schema and is logged once", () => {
    const errors = [];
    let reads = 0;
    const validate = createDocumentValidator({
        readSchema: () => {
            reads += 1;
            const error = new Error(`ENOENT ${PRIVATE_MARKER}`);
            error.code = "ENOENT";
            throw error;
        },
        logger: { error: (...args) => errors.push(args.join(" ")) },
    });

    for (let i = 0; i < 2; i += 1) {
        assert.deepEqual(validate(STUDENT_RESULT_DOCUMENT_SCHEMA, minimalDocument()), {
            valid:    false,
            problems: [{ code: "schema_unavailable", path: ROOT_PATH }],
        });
    }
    assert.equal(reads, 1);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /"documentSchema":"student-result\/v1"/u);
    assert.match(errors[0], /"errorCode":"ENOENT"/u);
    assert.doesNotMatch(errors[0], /private student/u);
});

test("only document schema names may be logged", () => {
    assert.equal(loggableDocumentSchema("student-result/v1"), "student-result/v1");
    for (const value of [PRIVATE_MARKER, "student-result", "Student-Result/v1", `x/v1${"0".repeat(70)}`, 1, null]) {
        assert.equal(loggableDocumentSchema(value), null, String(value));
    }
});
