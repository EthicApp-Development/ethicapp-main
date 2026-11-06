import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { Validator } from "@cfworker/json-schema";

// Verbatim copy of ethicapp-ai-additions' schema (#1130); see
// canonical-schemas/ai-additions/README.md before changing these files.
const SCHEMA_URL = new URL("../ai-additions/student-result.v1.schema.json", import.meta.url);
const EXAMPLES_URL = new URL(
    "../ai-additions/examples/student-result.v1/",
    import.meta.url
);

const EXPECTED_ID =
    "https://github.com/EthicApp-Development/ethicapp-ai-additions/schemas/student-result/v1";
const EXPECTED_SCHEMA_VERSION = "student-result/v1";

const schema = JSON.parse(readFileSync(SCHEMA_URL, "utf8"));
const validator = new Validator(schema, "2020-12", false);

function readExamples() {
    return readdirSync(EXAMPLES_URL)
        .filter(name => name.endsWith(".json"))
        .sort()
        .map(name => ({
            name,
            document: JSON.parse(readFileSync(new URL(name, EXAMPLES_URL), "utf8")),
        }));
}

function minimalDocument() {
    return {
        schemaVersion: EXPECTED_SCHEMA_VERSION,
        locale:        "en-US",
        title:         "Feedback on your response",
        sections:      [{ kind: "text", text: "Your response was received." }],
    };
}

function withSection(section) {
    return { ...minimalDocument(), sections: [section] };
}

function criteriaSection(criterion) {
    return {
        kind:  "criteria",
        items: [{ key: "evidence", label: "Evidence", value: "2 of 3", ...criterion }],
    };
}

// Leaf errors only: allOf and if/then wrappers repeat them without detail.
function describeErrors(result) {
    return result.errors
        .filter(error => !/subschema|does not match schema|Items did not match/u.test(error.error))
        .map(error => `${error.instanceLocation}: ${error.error}`)
        .join("\n");
}

function assertValid(document, label) {
    const result = validator.validate(document);
    assert.equal(result.valid, true, `${label} should be valid:\n${describeErrors(result)}`);
}

function assertInvalid(document, label) {
    assert.equal(validator.validate(document).valid, false, `${label} should be invalid`);
}

// ─── The copy ────────────────────────────────────────────────────────────────

test("the copy is the draft 2020-12 student-result/v1 schema", () => {
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.equal(schema.$id, EXPECTED_ID);
    assert.deepEqual(schema.properties.schemaVersion, { const: EXPECTED_SCHEMA_VERSION });
});

test("every example validates and its locale matches its file name", () => {
    const examples = readExamples();
    assert.ok(examples.length > 0, "the examples folder has documents");

    for (const { name, document } of examples) {
        assertValid(document, name);
        assert.equal(document.schemaVersion, EXPECTED_SCHEMA_VERSION, `${name} schemaVersion`);
        const [, fileLocale] = name.match(/\.([a-z]{2}_[A-Z]{2})\.json$/u) ?? [];
        assert.equal(document.locale, fileLocale?.replace("_", "-"), `${name} locale`);
    }
});

// ─── Documents the contract refuses ──────────────────────────────────────────

test("a document without a title, or with a title on two lines, is invalid", () => {
    const withoutTitle = minimalDocument();
    delete withoutTitle.title;
    assertInvalid(withoutTitle, "missing title");
    assertInvalid({ ...minimalDocument(), title: "Feedback\non your response" }, "two-line title");
    assertInvalid({ ...minimalDocument(), title: "   " }, "blank title");
    assertInvalid({ ...minimalDocument(), title: "x".repeat(121) }, "title over 120 characters");
});

test("a locale outside es-CL and en-US is invalid", () => {
    for (const locale of ["fr-FR", "en_US", "es", ""]) {
        assertInvalid({ ...minimalDocument(), locale }, `locale ${JSON.stringify(locale)}`);
    }
});

test("a top-level key the schema does not define is invalid", () => {
    assertInvalid({ ...minimalDocument(), tutorMode: "enhanced" }, "tutorMode");
    assertInvalid({ ...minimalDocument(), schemaVersion: "student-result/v2" },
        "another schemaVersion");
});

test("a malformed section of a known kind is invalid", () => {
    assertInvalid(withSection({ kind: "criteria", items: [] }), "criteria without items");
    assertInvalid(withSection({ kind: "text", items: ["A point"] }), "text section with items");
    assertInvalid(withSection({ kind: "bullets", items: ["A point"], claimTypeId: "AF1" }),
        "bullets section with an extra key");
    assertInvalid(withSection(criteriaSection({ evidenceFactIds: ["EV1"] })),
        "criterion with an extra key");
    assertInvalid(withSection(criteriaSection({ key: "Evidence" })),
        "criterion key outside the pattern");
    assertInvalid(
        withSection({ kind: "comparison", items: [{ label: "Claim", before: "Against" }] }),
        "comparison item without after");
    assertInvalid(withSection({
        kind:  "comparison",
        items: [{ label: "Claim", before: "Against", after: "In favor", trend: "better" }],
    }), "comparison item with an unknown trend");
});

test("score bounds follow dependentRequired", () => {
    assertValid(withSection(criteriaSection({ score: 2, maxScore: 3 })), "score and maxScore");
    assertValid(withSection(criteriaSection({ score: 2 })), "score alone");
    assertInvalid(withSection(criteriaSection({ maxScore: 3 })), "maxScore without score");
    assertInvalid(withSection(criteriaSection({ score: 2, minScore: 1 })),
        "minScore without maxScore");
});

// ─── The extension point ─────────────────────────────────────────────────────

test("a section of an unknown kind in kebab case is accepted with any fields", () => {
    assertValid(withSection({ kind: "score-chart", series: [{ label: "Evidence", value: 2 }] }),
        "score-chart section");
    assertValid({ ...minimalDocument(), sections: [] }, "no sections");
});

test("an unknown kind outside kebab case is invalid", () => {
    for (const kind of ["ScoreChart", "score_chart", "score-chart\n", "-chart"]) {
        assertInvalid(withSection({ kind }), `kind ${JSON.stringify(kind)}`);
    }
    assertInvalid(withSection({ title: "No kind" }), "section without kind");
});
