// The dev mock adapters' report-building contributions (epic #620, #945),
// validated against the real contract.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
    buildReportContribution as buildReviewContribution,
    register as registerReview,
    REPORT_NOTE_COLUMN,
} from "../mock-ai-response-review.adapter.js";
import {
    buildReportContribution as buildChatContribution,
    register as registerChat,
    REPORT_SHOWN_COLUMN,
} from "../mock-chat-agent.adapter.js";
import { validateReportContribution } from "../../../services/external-service-report-contributions.js";

const manifest = JSON.parse(await fs.readFile(new URL("../../manifest.json", import.meta.url), "utf8"));

function entry(id) {
    return manifest.services.find(service => service.id === id);
}

function rowKeysOf(rows, key) {
    return new Map(rows.map(row => [String(row[key]), row[key]]));
}

async function subscriptionsOf(register, serviceId) {
    const handlers = new Map();
    await register({
        service:                 { id: serviceId },
        subscribe:               (hookName, handler) => handlers.set(hookName, handler),
        publishStudentResult:    async () => true,
        publishGroupChatMessage: async () => null,
    });
    return handlers;
}

const RESPONSE_ROWS = [
    { responseId: 101, phaseId: 1, questionId: 7, userId: 31, groupId: null },
    { responseId: 102, phaseId: 1, questionId: 7, userId: 32, groupId: null },
];

test("both mock adapters declare report-building with their column prefixes", () => {
    assert.ok(entry("mock-ai-response-review").hooks.includes("report-building"));
    assert.deepEqual(entry("mock-ai-response-review").report, { columnPrefix: "mockreview_" });
    assert.ok(entry("mock-chat-agent").hooks.includes("report-building"));
    assert.deepEqual(entry("mock-chat-agent").report, { columnPrefix: "mockchat_" });
});

test("mock-ai-response-review notes every response with its stored results", async () => {
    const handlers = await subscriptionsOf(registerReview, "mock-ai-response-review");
    assert.equal(handlers.get("report-building"), buildReviewContribution);

    const listed = [];
    const results = {
        list: async filters => {
            listed.push(filters);
            return [
                { source: { kind: "response", id: 102 } },
                { source: { kind: "response", id: 102 } },
                { source: null },
            ];
        },
    };
    const contribution = await buildReviewContribution({ reportType: "responses", rows: RESPONSE_ROWS }, { results });

    assert.deepEqual(listed, [{ hookName: "student-response-submitted" }]);
    assert.deepEqual(contribution.values.map(entry => entry.values[REPORT_NOTE_COLUMN]), [
        "Mock review of response 101: 0 stored result(s).",
        "Mock review of response 102: 2 stored result(s).",
    ]);
    assert.equal(validateReportContribution(contribution, {
        reportType:   "responses",
        rowKeys:      rowKeysOf(RESPONSE_ROWS, "responseId"),
        columnPrefix: "mockreview_",
    }).valid, true);

    assert.equal(await buildReviewContribution({ reportType: "chat_transcript", rows: [] }, { results }), null);
});

test("mock-chat-agent marks its messages and adds one hidden summary row per group", async () => {
    const serviceId = "mock-chat-agent";
    const handlers = await subscriptionsOf(registerChat, serviceId);
    const message = (messageId, groupId, externalServiceId, time) => ({
        messageId,
        phaseId:    1,
        questionId: 7,
        groupId,
        externalServiceId,
        time,
    });
    const rows = [
        message(1, 4, null, "2026-10-01T10:00:00.000Z"),
        message(2, 4, serviceId, "2026-10-01T10:00:05.000Z"),
        message(3, 4, null, "2026-10-01T10:01:00.000Z"),
        message(4, 5, null, "2026-10-01T10:02:00.000Z"),
    ];
    const context = { reportType: "chat_transcript", rows };

    const contribution = await handlers.get("report-building")(context, { results: { list: async () => [] } });

    assert.deepEqual(contribution.columns, [{ id: REPORT_SHOWN_COLUMN, label: "Shown to students" }]);
    assert.deepEqual(contribution.values, [{ rowKey: 2, values: { [REPORT_SHOWN_COLUMN]: true } }]);
    assert.deepEqual(contribution.rows, [{
        phaseId:    1,
        questionId: 7,
        groupId:    4,
        time:       "2026-10-01T10:00:06.000Z",
        message:    "Mock chat agent summary: 3 message(s) in this group, 1 from the agent.",
        values:     { [REPORT_SHOWN_COLUMN]: false },
    }]);
    assert.equal(validateReportContribution(contribution, {
        reportType:   "chat_transcript",
        rowKeys:      rowKeysOf(rows, "messageId"),
        columnPrefix: "mockchat_",
    }).valid, true);

    assert.equal(buildChatContribution({ reportType: "responses", rows: RESPONSE_ROWS }, serviceId), null);
});
