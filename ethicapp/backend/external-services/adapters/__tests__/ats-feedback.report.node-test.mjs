// The argumentation tutor's report-building contribution (epic #620, #948),
// validated against the real contract.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { register } from "../ats-feedback.adapter.js";
import {
    ATS_REPORT_COLUMNS,
    buildReportContribution,
    feedbackColumnValues,
} from "../ats-feedback.report.js";
import { validateReportContribution } from "../../../services/external-service-report-contributions.js";

const SERVICE_ID = "argumentation-tutor-system";
const manifest = JSON.parse(await fs.readFile(new URL("../../manifest.json", import.meta.url), "utf8"));
const tutorEntry = manifest.services.find(service => service.id === SERVICE_ID);

const ROWS = Object.freeze([
    { responseId: 101, phaseId: 1, questionId: 7, userId: 31, groupId: null },
    { responseId: 102, phaseId: 1, questionId: 7, userId: 32, groupId: null },
    { responseId: 103, phaseId: 1, questionId: 8, userId: 31, groupId: null },
]);

const ARGUMENT = "I think the company should disclose the defect because people trust it.";

function analysisPayload(overrides = {}) {
    return {
        sessionId:  5,
        phaseId:    1,
        questionId: 7,
        userId:     31,
        title:      "Argument Tutor Feedback",
        summary:    "The claim is clear; the evidence is thin.",
        mode:       "analysis",
        criteria:   [
            { key: "claim", label: "Claim", score: 1, value: "In favor (1)" },
            { key: "evidence", label: "Evidence", score: 1, value: "1/3" },
            { key: "warrant", label: "Warrant", score: 2, value: "2/3" },
            { key: "qualifier", label: "Qualifier", score: 0, value: "0/3" },
        ],
        bullets:            ["State your evidence.", "Link it to the claim."],
        argumentPreview:    ARGUMENT,
        comparison:         null,
        claimTypeId:        "AF2",
        claimTypeRationale: "Argues for disclosure.",
        tutorMode:          "enhanced",
        requestedMode:      "enhanced",
        unsupportedClaims:  [
            { statement: "The defect killed people.", exclusionId: "EX1" },
            { statement: "The CEO knew.", exclusionId: null },
        ],
        ...overrides,
    };
}

function comparisonPayload(overrides = {}) {
    return analysisPayload({
        summary:  "The revision adds evidence.",
        mode:     "comparison",
        criteria: [
            { key: "claim", label: "Claim", score: 1, value: "In favor (1)" },
            { key: "evidence", label: "Evidence", score: 3, value: "3/3" },
            { key: "warrant", label: "Warrant", score: 2, value: "2/3" },
            { key: "qualifier", label: "Qualifier", score: 1, value: "1/3" },
        ],
        bullets:    ["Good use of the report."],
        comparison: {
            initialArgument: ARGUMENT,
            revisedArgument: `${ARGUMENT} The safety report shows it.`,
            scores:          { evidence: { initial: 1, revised: 3, delta: 2 } },
        },
        claimTypeId:        undefined,
        claimTypeRationale: undefined,
        tutorMode:          undefined,
        requestedMode:      undefined,
        unsupportedClaims:  undefined,
        ...overrides,
    });
}

let nextId = 1;
function result({
    responseId = 101, userId = 31, phaseId = 1, questionId = 7, status = "completed",
    receivedAt = "2026-11-02T10:00:00.000Z", rawPayload = analysisPayload(), source,
} = {}) {
    return {
        id:            nextId++,
        jobId:         nextId,
        hookName:      "student-response-submitted",
        status,
        phaseId,
        questionId,
        groupId:       null,
        userId,
        source:        source === undefined ? { kind: "response", id: responseId } : source,
        rawPayload,
        adapterResult: { status: "completed" },
        receivedAt,
    };
}

function readerOf(stored) {
    const calls = [];
    return {
        calls,
        results: { list: async filters => {
            calls.push(filters);
            return stored;
        } },
    };
}

async function contribute(stored, rows = ROWS) {
    const reader = readerOf(stored);
    const contribution = await buildReportContribution(
        {
            reportType: "responses",
            serviceId:  SERVICE_ID,
            sessionId:  5,
            designType: "semantic_differential",
            rows,
        },
        { results: reader.results }
    );
    return { contribution, calls: reader.calls };
}

function valuesByRow(contribution) {
    return new Map(contribution.values.map(entry => [entry.rowKey, entry.values]));
}

function validate(contribution, rows = ROWS) {
    return validateReportContribution(contribution, {
        reportType:        "responses",
        rowKeys:           new Map(rows.map(row => [String(row.responseId), row.responseId])),
        columnPrefix:      tutorEntry.report.columnPrefix,
        reservedColumnIds: new Set(["comment", "user_id", "phase"]),
    });
}

function assertNoArgumentText(contribution) {
    for (const { values } of contribution.values) {
        for (const value of Object.values(values)) {
            if (typeof value === "string") {
                assert.equal(value.includes("disclose the defect"), false,
                    "no column quotes the argument");
            }
        }
    }
}

test("the manifest subscribes the tutor to report-building with the ats_ prefix", async () => {
    assert.ok(tutorEntry.hooks.includes("report-building"));
    assert.deepEqual(tutorEntry.report, { columnPrefix: "ats_" });

    const handlers = new Map();
    await register({
        subscribe:            (hookName, handler) => handlers.set(hookName, handler),
        publishStudentResult: async () => true,
    });
    assert.equal(handlers.get("report-building"), buildReportContribution);
});

test("a sourced result fills its response row and leaves the others empty", async () => {
    const { contribution, calls } = await contribute([result({ responseId: 101 })]);

    assert.deepEqual(calls, [{ hookName: "student-response-submitted" }]);
    assert.deepEqual(contribution.columns.map(column => column.id),
        ATS_REPORT_COLUMNS.map(column => column.id));
    assert.deepEqual(contribution.values, [{
        rowKey: 101,
        values: {
            ats_mode:               "analysis",
            ats_tutor_mode:         "enhanced",
            ats_requested_mode:     "enhanced",
            ats_feedback_title:     "Argument Tutor Feedback",
            ats_feedback_summary:   "The claim is clear; the evidence is thin.",
            ats_feedback_bullets:   "State your evidence.\nLink it to the claim.",
            ats_claim:              1,
            ats_evidence:           1,
            ats_warrant:            2,
            ats_qualifier:          0,
            ats_claim_type:         "AF2",
            ats_unsupported_claims: 2,
            ats_feedback_count:     1,
            ats_feedback_time:      "2026-11-02T10:00:00.000Z",
        },
    }]);
    assertNoArgumentText(contribution);
    assert.equal(validate(contribution).valid, true);
});

test("an analysis and its comparisons show the latest and count them all", async () => {
    const { contribution } = await contribute([
        result({ receivedAt: "2026-11-02T10:00:00.000Z" }),
        result({ receivedAt: "2026-11-02T10:20:00.000Z", rawPayload: comparisonPayload() }),
        result({
            receivedAt: "2026-11-02T10:10:00.000Z",
            rawPayload: comparisonPayload({ summary: "Earlier." }),
        }),
    ]);

    const values = valuesByRow(contribution).get(101);
    assert.equal(contribution.values.length, 1);
    assert.equal(values.ats_feedback_count, 3);
    assert.equal(values.ats_feedback_time, "2026-11-02T10:20:00.000Z");
    assert.equal(values.ats_mode, "comparison");
    assert.equal(values.ats_feedback_summary, "The revision adds evidence.");
    assert.equal(values.ats_evidence, 3);
    // A comparison reports no claim type or mode; the earlier analysis's are not mixed in.
    assert.equal(values.ats_claim_type, null);
    assert.equal(values.ats_tutor_mode, null);
    assert.equal(values.ats_unsupported_claims, null);
    assertNoArgumentText(contribution);
    assert.equal(validate(contribution).valid, true);
});

test("a legacy result goes to the only row with its phase, question and user", async () => {
    const { contribution } = await contribute([
        result({ source: null, userId: 32, questionId: 7 }),
        result({ source: null, userId: 31, questionId: 8, receivedAt: "2026-11-02T09:00:00.000Z" }),
        // A legacy result and a sourced one of the same response add up.
        result({
            responseId: 103,
            userId:     31,
            questionId: 8,
            receivedAt: "2026-11-02T11:00:00.000Z",
            rawPayload: comparisonPayload(),
        }),
    ]);

    const byRow = valuesByRow(contribution);
    assert.deepEqual([...byRow.keys()].sort(), [102, 103]);
    assert.equal(byRow.get(102).ats_feedback_count, 1);
    assert.equal(byRow.get(103).ats_feedback_count, 2);
    assert.equal(byRow.get(103).ats_mode, "comparison");
    assert.equal(validate(contribution).valid, true);
});

test("a legacy result is left out when its keys match several rows or none", async () => {
    const rows = [
        ...ROWS,
        { responseId: 104, phaseId: 1, questionId: 7, userId: 31, groupId: null },
    ];
    const { contribution } = await contribute([
        result({ source: null, userId: 31, questionId: 7 }),
        result({ source: null, userId: 99, questionId: 7 }),
        result({ source: null, userId: null, questionId: 7 }),
    ], rows);

    assert.deepEqual(contribution.values, []);
    assert.equal(validate(contribution, rows).valid, true);
});

test("results of absent responses, other users or messages are ignored", async () => {
    const { contribution } = await contribute([
        result({ responseId: 555 }),
        result({ responseId: 102, userId: 31 }),
        result({ source: { kind: "chat_message", id: 101 } }),
    ]);

    assert.deepEqual(contribution.values, []);
    assert.equal(validate(contribution).valid, true);
});

test("failed results are left out and redacted results are shown as stored", async () => {
    const redacted = "[forgotten user]";
    const { contribution } = await contribute([
        result({ responseId: 101, status: "failed" }),
        result({ responseId: 101, status: "unknown-correlation" }),
        result({
            responseId: 102,
            userId:     32,
            status:     "callback-received",
            rawPayload: analysisPayload({
                title:             redacted,
                summary:           redacted,
                bullets:           [redacted, redacted],
                argumentPreview:   redacted,
                claimTypeId:       redacted,
                unsupportedClaims: [{ statement: redacted, exclusionId: redacted }],
            }),
        }),
    ]);

    const byRow = valuesByRow(contribution);
    assert.deepEqual([...byRow.keys()], [102]);
    const values = byRow.get(102);
    assert.equal(values.ats_feedback_title, redacted);
    assert.equal(values.ats_feedback_summary, redacted);
    assert.equal(values.ats_feedback_bullets, `${redacted}\n${redacted}`);
    assert.equal(values.ats_claim_type, null, "a redacted claim type is not an AF# id");
    assert.equal(values.ats_unsupported_claims, 1);
    assert.equal(values.ats_claim, 1, "numbers are not redacted");
    assert.equal(validate(contribution).valid, true);
});

test("missing or malformed fields are empty and long texts stay within the contract", () => {
    assert.deepEqual(feedbackColumnValues(null), {
        ats_mode:               null,
        ats_tutor_mode:         null,
        ats_requested_mode:     null,
        ats_feedback_title:     null,
        ats_feedback_summary:   null,
        ats_feedback_bullets:   null,
        ats_claim:              null,
        ats_evidence:           null,
        ats_warrant:            null,
        ats_qualifier:          null,
        ats_claim_type:         null,
        ats_unsupported_claims: null,
    });

    const values = feedbackColumnValues({
        mode:     "turbo",
        title:    42,
        summary:  "x".repeat(20000),
        bullets:  "not a list",
        criteria: [{ key: "Evidence", score: "2" }, { key: "novelty", score: 3 }, null],
    });
    assert.equal(values.ats_mode, null);
    assert.equal(values.ats_feedback_title, null);
    assert.equal(values.ats_feedback_summary.length, 10000);
    assert.equal(values.ats_feedback_bullets, null);
    assert.equal(values.ats_evidence, null, "a score that is not a number is empty");
    assert.equal(Object.hasOwn(values, "ats_novelty"), false);

    const nested = feedbackColumnValues({ payload: { feedback: { mode: "comparison" } } });
    assert.equal(nested.ats_mode, "comparison");
});

test("the chat transcript gets nothing", async () => {
    const reader = readerOf([result()]);
    const contribution = await buildReportContribution(
        { reportType: "chat_transcript", sessionId: 5, rows: [] },
        { results: reader.results }
    );
    assert.equal(contribution, null);
    assert.deepEqual(reader.calls, []);
});

test("a session without tutor results still declares the columns", async () => {
    const { contribution } = await contribute([]);
    assert.equal(contribution.columns.length, ATS_REPORT_COLUMNS.length);
    assert.deepEqual(contribution.values, []);
    assert.equal(validate(contribution).valid, true);
});
