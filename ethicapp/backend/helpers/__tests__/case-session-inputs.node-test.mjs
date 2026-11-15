// Session inputs that come from the case's analyses (#1220): which ones a
// configuration requires, and their values or why they are missing. The
// descriptors are made up for services that do not exist, so nothing here
// depends on a real service; case analyses come from fake reads.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    CASE_INPUT_READY,
    CASE_INPUT_STATUSES,
    caseAnalysisInputStatus,
    caseSessionInputs,
    resolveCaseSessionInputs,
    resolveJsonPointer,
} from "../case-session-inputs.js";
import { normalizeDescriptor } from "../../services/capability-descriptors.service.js";

const CASE_ID = 42;

// A raw descriptor of an imaginary essay reviewer: `review_style` defaults to
// "strict"; the glossary is required in the "glossary" and "strict" styles,
// the case summary is optional, and `phase_clock` is not a case input.
function rawDescriptor(overrides = {}) {
    return {
        contract_version:       "1",
        service:                { id: "essay-reviewer", name: "Essay reviewer", uses_llm: true },
        instance_configuration: {
            fields: [
                {
                    key:        "review_style",
                    type:       "enum",
                    required:   false,
                    default:    "strict",
                    display:    { label: "Style" },
                    validation: {
                        enum: [
                            { value: "strict", label: "Strict" },
                            { value: "glossary", label: "Glossary" },
                            { value: "free", label: "Free" },
                        ],
                    },
                },
                {
                    key:        "rounds",
                    type:       "integer",
                    required:   false,
                    default:    2,
                    display:    { label: "Rounds" },
                    validation: { minimum: 1, maximum: 5 },
                },
            ],
        },
        runtime_configuration: { fields: [] },
        session_inputs:        {
            phase_clock: { required: ["duration_seconds"] },
            glossary:    {
                source:        { kind: "case_analysis", document_schema: "glossary/v2", pointer: "/terms" },
                required_when: [
                    { field: "review_style", in: ["glossary"] },
                    { field: "review_style", in: ["strict"] },
                ],
            },
            summary: {
                source: { kind: "case_analysis", document_schema: "case-summary/v1", pointer: "" },
            },
            rounds_hint: {
                source:        { kind: "case_analysis", document_schema: "hints/v1", pointer: "/0" },
                required_when: [{ field: "rounds", in: [3, 4] }],
            },
        },
        ...overrides,
    };
}

function descriptor(overrides = {}) {
    const result = normalizeDescriptor(rawDescriptor(overrides), "essay-reviewer");
    assert.equal(result.ok, true);
    return { available: true, ...result.descriptor };
}

const GLOSSARY = { schemaVersion: "glossary/v2", terms: [{ id: "G1", term: "Consent" }] };
const SUMMARY = { schemaVersion: "case-summary/v1", text: "A case." };

function readyRow(documentSchema, document, extra = {}) {
    return {
        case_id:         CASE_ID,
        status:          "ready",
        document_schema: documentSchema,
        document,
        reviewed_at:     null,
        is_stale:        false,
        ...extra,
    };
}

// Fake catalog and case analyses: `rows` maps an adapter id to its row.
function fakeDeps(rows = {}, producers = {
    "glossary/v2":     ["glossary-maker"],
    "case-summary/v1": ["summarizer"],
    "hints/v1":        ["hinter"],
}) {
    const reads = [];
    return {
        reads,
        deps: {
            producerServiceIds: documentSchema => producers[documentSchema] ?? [],
            getCaseAnalysis:    async ({ caseId, serviceId }) => {
                reads.push({ caseId, serviceId });
                return rows[serviceId] ?? null;
            },
        },
    };
}

describe("caseSessionInputs", () => {
    it("requires an input when a condition holds for the stored value", () => {
        assert.deepEqual(caseSessionInputs(descriptor(), { review_style: "glossary" }), [
            {
                key:      "glossary",
                source:   { kind: "case_analysis", documentSchema: "glossary/v2", pointer: "/terms", requireReviewed: false },
                required: true,
            },
            {
                key:      "summary",
                source:   { kind: "case_analysis", documentSchema: "case-summary/v1", pointer: "", requireReviewed: false },
                required: false,
            },
        ]);
    });

    it("uses the field's default when the configuration stores no value", () => {
        for (const configuration of [{}, null, undefined, { review_style: null }]) {
            const keys = caseSessionInputs(descriptor(), configuration)
                .map(({ key, required }) => [key, required]);
            assert.deepEqual(keys, [["glossary", true], ["summary", false]]);
        }
    });

    it("leaves out an input whose conditions do not hold", () => {
        const inputs = caseSessionInputs(descriptor(), { review_style: "free" });
        assert.deepEqual(inputs.map(input => input.key), ["summary"]);
    });

    it("compares values strictly, numbers included", () => {
        assert.deepEqual(
            caseSessionInputs(descriptor(), { review_style: "free", rounds: 3 })
                .map(({ key, required }) => [key, required]),
            [["summary", false], ["rounds_hint", true]]
        );
        assert.deepEqual(
            caseSessionInputs(descriptor(), { review_style: "free", rounds: "3" })
                .map(input => input.key),
            ["summary"]
        );
    });

    it("never holds a condition on a field without a value or default", () => {
        const withoutField = descriptor({
            session_inputs: {
                glossary: {
                    source:        { kind: "case_analysis", document_schema: "glossary/v2", pointer: "" },
                    required_when: [{ field: "undeclared", in: ["x"] }],
                },
            },
        });
        assert.deepEqual(caseSessionInputs(withoutField, {}), []);
        assert.deepEqual(caseSessionInputs(withoutField, { undeclared: "x" })
            .map(input => input.required), [true]);
    });

    it("reads a raw descriptor as well as a normalized one", () => {
        assert.deepEqual(
            caseSessionInputs(rawDescriptor(), { review_style: "glossary" }),
            caseSessionInputs(descriptor(), { review_style: "glossary" })
        );
    });

    it("is empty for a descriptor without case inputs", () => {
        assert.deepEqual(caseSessionInputs(descriptor({ session_inputs: undefined }), {}), []);
        assert.deepEqual(caseSessionInputs(null, {}), []);
        assert.deepEqual(caseSessionInputs({ available: false, reason: "unreachable" }), []);
    });
});

describe("resolveJsonPointer", () => {
    const document = {
        "terms":  [{ id: "G1" }, { id: "G2" }],
        "a/b":    { "c~d": 7 },
        "":       "empty key",
        "nested": { value: null },
    };

    it("follows RFC 6901", () => {
        assert.deepEqual(resolveJsonPointer(document, ""), { found: true, value: document });
        assert.deepEqual(resolveJsonPointer(document, "/terms/1"), { found: true, value: { id: "G2" } });
        assert.deepEqual(resolveJsonPointer(document, "/terms/0/id"), { found: true, value: "G1" });
        assert.deepEqual(resolveJsonPointer(document, "/a~1b/c~0d"), { found: true, value: 7 });
        assert.deepEqual(resolveJsonPointer(document, "/"), { found: true, value: "empty key" });
        assert.deepEqual(resolveJsonPointer(document, "/nested/value"), { found: true, value: null });
    });

    it("finds nothing outside the document", () => {
        for (const pointer of ["/missing", "/terms/2", "/terms/-", "/terms/01", "/terms/x", "terms", "/terms/0/id/x"]) {
            assert.deepEqual(resolveJsonPointer(document, pointer), { found: false }, pointer);
        }
        assert.deepEqual(resolveJsonPointer(null, "/x"), { found: false });
        assert.deepEqual(resolveJsonPointer({ toString: 1 }, "/hasOwnProperty"), { found: false });
    });
});

describe("caseAnalysisInputStatus", () => {
    const source = { documentSchema: "glossary/v2", pointer: "/terms", requireReviewed: false };

    it("is ready with a copy of the pointed part", () => {
        const row = readyRow("glossary/v2", structuredClone(GLOSSARY));
        const result = caseAnalysisInputStatus(row, source);
        assert.deepEqual(result, { status: CASE_INPUT_READY, value: GLOSSARY.terms });
        result.value[0].term = "changed";
        assert.equal(row.document.terms[0].term, "Consent");
    });

    it("names why an analysis cannot be used", () => {
        const S = CASE_INPUT_STATUSES;
        const cases = [
            [null, S.ABSENT],
            [{ status: "requested", is_stale: false }, S.PENDING],
            [{ status: "processing", is_stale: false, document: GLOSSARY }, S.PENDING],
            [{ status: "processing", is_stale: true }, S.FAILED],
            [{ status: "failed", document: null }, S.FAILED],
            [readyRow("glossary/v2", null), S.ABSENT],
            [readyRow("glossary/v1", GLOSSARY), S.ABSENT],
            [readyRow("glossary/v2", { schemaVersion: "glossary/v2" }), S.FAILED],
        ];
        for (const [row, status] of cases) {
            assert.deepEqual(caseAnalysisInputStatus(row, source), { status }, JSON.stringify(row));
        }
    });

    it("accepts an unreviewed draft unless the source requires a review", () => {
        const draft = readyRow("glossary/v2", GLOSSARY);
        assert.equal(caseAnalysisInputStatus(draft, source).status, CASE_INPUT_READY);
        assert.deepEqual(caseAnalysisInputStatus(draft, { ...source, requireReviewed: true }),
            { status: CASE_INPUT_STATUSES.NOT_REVIEWED });

        const reviewed = readyRow("glossary/v2", GLOSSARY, { reviewed_at: "2026-11-15T10:00:00Z" });
        assert.equal(caseAnalysisInputStatus(reviewed, { ...source, requireReviewed: true }).status,
            CASE_INPUT_READY);
    });
});

describe("resolveCaseSessionInputs", () => {
    it("reads each input's analysis through the catalog and returns the values", async () => {
        const { deps, reads } = fakeDeps({
            "glossary-maker": readyRow("glossary/v2", GLOSSARY),
            "summarizer":     readyRow("case-summary/v1", SUMMARY),
        });

        const result = await resolveCaseSessionInputs({
            descriptor:    descriptor(),
            configuration: {},
            caseId:        CASE_ID,
            deps,
        });

        assert.deepEqual(result, { values: { glossary: GLOSSARY.terms, summary: SUMMARY }, missing: [] });
        assert.deepEqual(reads, [
            { caseId: CASE_ID, serviceId: "glossary-maker" },
            { caseId: CASE_ID, serviceId: "summarizer" },
        ]);
    });

    it("lists a required input that cannot be resolved, and leaves out an optional one", async () => {
        for (const [row, status] of [
            [null, "absent"],
            [{ status: "processing", is_stale: false }, "pending"],
            [{ status: "failed" }, "failed"],
        ]) {
            const { deps } = fakeDeps({ "glossary-maker": row, "summarizer": { status: "failed" } });
            const result = await resolveCaseSessionInputs({
                descriptor: descriptor(), configuration: { review_style: "strict" }, caseId: CASE_ID, deps,
            });
            assert.deepEqual(result, {
                values:  {},
                missing: [{ key: "glossary", documentSchema: "glossary/v2", status }],
            });
        }
    });

    it("reports not_reviewed only for a source that requires a review", async () => {
        const reviewing = descriptor({
            session_inputs: {
                glossary: {
                    source:        { kind: "case_analysis", document_schema: "glossary/v2", pointer: "/terms", require_reviewed: true },
                    required_when: [{ field: "review_style", in: ["strict"] }],
                },
            },
        });
        const { deps } = fakeDeps({ "glossary-maker": readyRow("glossary/v2", GLOSSARY) });

        assert.deepEqual(
            await resolveCaseSessionInputs({ descriptor: reviewing, caseId: CASE_ID, deps }),
            { values: {}, missing: [{ key: "glossary", documentSchema: "glossary/v2", status: "not_reviewed" }] }
        );
    });

    it("finds nothing without a case or without an adapter that produces the schema", async () => {
        const { deps, reads } = fakeDeps({ "glossary-maker": readyRow("glossary/v2", GLOSSARY) });
        for (const caseId of [null, undefined, 0, "x"]) {
            const result = await resolveCaseSessionInputs({ descriptor: descriptor(), caseId, deps });
            assert.deepEqual(result.missing, [{ key: "glossary", documentSchema: "glossary/v2", status: "absent" }]);
        }
        assert.deepEqual(reads, []);

        const unproduced = fakeDeps({}, {});
        assert.deepEqual(
            (await resolveCaseSessionInputs({ descriptor: descriptor(), caseId: CASE_ID, deps: unproduced.deps })).missing,
            [{ key: "glossary", documentSchema: "glossary/v2", status: "absent" }]
        );
    });

    it("uses the first ready analysis among several producers, else the closest to ready", async () => {
        const producers = { "glossary/v2": ["old-maker", "new-maker"] };
        const ready = fakeDeps({
            "old-maker": { status: "failed" },
            "new-maker": readyRow("glossary/v2", GLOSSARY),
        }, producers);
        assert.deepEqual(
            (await resolveCaseSessionInputs({ descriptor: descriptor(), caseId: CASE_ID, deps: ready.deps })).values,
            { glossary: GLOSSARY.terms }
        );

        const notYet = fakeDeps({
            "old-maker": { status: "failed" },
            "new-maker": { status: "requested", is_stale: false },
        }, producers);
        assert.deepEqual(
            (await resolveCaseSessionInputs({ descriptor: descriptor(), caseId: CASE_ID, deps: notYet.deps })).missing,
            [{ key: "glossary", documentSchema: "glossary/v2", status: "pending" }]
        );
    });

    it("needs nothing when no input is required and no analysis is ready", async () => {
        const { deps } = fakeDeps({});
        assert.deepEqual(
            await resolveCaseSessionInputs({
                descriptor: descriptor(), configuration: { review_style: "free" }, caseId: CASE_ID, deps,
            }),
            { values: {}, missing: [] }
        );
    });

    it("lets read failures through", async () => {
        await assert.rejects(() => resolveCaseSessionInputs({
            descriptor: descriptor(),
            caseId:     CASE_ID,
            deps:       {
                producerServiceIds: () => ["glossary-maker"],
                getCaseAnalysis:    async () => {
                    throw new Error("database down");
                },
            },
        }), /database down/u);
    });
});
