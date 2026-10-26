import assert from "node:assert/strict";
import test from "node:test";

import {
    createPhaseStateLoader,
    resolveCallbackDestination,
} from "../callback-destination.js";

const normalize = sql => sql.replace(/\s+/g, " ").trim();

test("createPhaseStateLoader: one query over the session, phase, group and user", async () => {
    const calls = [];
    const row = { current_stage: 2, status: 2, launched: true, group_exists: true, user_participates: false };
    const load = createPhaseStateLoader({
        getDb: async () => ({
            async query(sql, params) {
                calls.push({ sql: normalize(sql), params });
                return { rows: [row] };
            },
        }),
    });

    assert.deepEqual(await load({ sessionId: 10, phaseId: 2, groupId: 3, userId: null }), row);
    assert.deepEqual(calls[0].params, [10, 2, 3, null]);
    assert.match(calls[0].sql, /FROM stages AS st INNER JOIN sessions AS s ON s\.id = st\.sesid/);
    assert.match(calls[0].sql, /FROM teams AS t WHERE t\.id = \$3 AND t\.stageid = st\.id/);
    assert.match(calls[0].sql, /FROM sesusers AS su WHERE su\.sesid = s\.id AND su\.uid = \$4/);
});

function dependencies(overrides = {}) {
    return {
        isAllowedByPolicy: () => true,
        policy:            {
            getSessionPolicyVersionId: async () => 2,
            getPolicyVersion:          async () => ({ id: 2, allowedServiceIds: ["polyadic-agent"] }),
        },
        isAiAdditionsConfigured: async () => true,
        loadPhaseState:          async () => ({
            current_stage: 2, status: 2, launched: true, group_exists: true, user_participates: true,
        }),
        loadPhaseExternalServices: async () => ({ enabledServiceIds: ["svc"] }),
        ...overrides,
    };
}

const SERVICE = { id: "svc", development: false };

test("resolveCallbackDestination: a verified destination, without questionId", async () => {
    assert.deepEqual(
        { ...await resolveCallbackDestination({
            service: SERVICE,
            target:  { sessionId: "10", phaseId: 2, groupId: 3 },
        }, dependencies()) },
        { sessionId: 10, phaseId: 2, groupId: 3, userId: null, questionId: null }
    );
});

test("resolveCallbackDestination: a target field the adapter names is required", async () => {
    for (const target of [
        null,
        { sessionId: 10 },
        { sessionId: 10, phaseId: 2, groupId: null },
        { sessionId: 10, phaseId: 2, questionId: 1, userId: null },
    ]) {
        await assert.rejects(
            resolveCallbackDestination({ service: SERVICE, target }, dependencies()),
            { statusCode: 409, code: "callback_without_job" },
            JSON.stringify(target)
        );
    }
});

test("resolveCallbackDestination: a user who does not take part is refused", async () => {
    await assert.rejects(
        resolveCallbackDestination({
            service: SERVICE,
            target:  { sessionId: 10, phaseId: 2, questionId: 4, userId: 5 },
        }, dependencies({
            loadPhaseState: async () => ({
                current_stage: 2, status: 2, launched: true, group_exists: false, user_participates: false,
            }),
        })),
        { statusCode: 409, code: "callback_user_unknown" }
    );
});

test("resolveCallbackDestination: the pinned version must allow the adapter", async () => {
    await assert.rejects(
        resolveCallbackDestination({
            service: SERVICE,
            target:  { sessionId: 10, phaseId: 2, groupId: 3 },
        }, dependencies({ isAllowedByPolicy: () => false })),
        { statusCode: 409, code: "callback_not_allowed" }
    );
});
