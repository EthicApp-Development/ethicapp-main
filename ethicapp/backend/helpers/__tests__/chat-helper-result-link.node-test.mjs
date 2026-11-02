import assert from "node:assert/strict";
import test from "node:test";
import {
    chatInsertHandlers,
    normalizeExternalServiceResultId,
    saveChatMessage,
} from "../chat-helper.js";

// The link from an agent chat message to the callback result it was
// published from (#947), with a fake execSQL and no database.

const RESULT_ID = "6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f";
const normalize = sql => sql.replace(/\s+/g, " ").trim();

// Resolves execSQL's plain parameters the way rest-pg-2 does.
function createExecSQL(row = { id: 1 }) {
    const calls = [];
    const execSQL = async ({ sql, sqlParams }) => {
        calls.push({
            sql:    normalize(sql),
            params: sqlParams.map(param => JSON.parse(param).name ?? null),
        });
        return [row];
    };
    return { calls, execSQL };
}

const agentMessage = {
    userId:          null,
    externalAgentId: 9,
    phaseId:         22,
    questionId:      701,
    groupId:         301,
    content:         "Which tradeoff matters most here?",
    parentId:        null,
    dbcon:           "postgres://fake",
};

const studentMessage = {
    ...agentMessage,
    userId:          5,
    externalAgentId: null,
};

for (const [designType, table] of [["ranking", "chat"], ["semantic_differential", "differential_chat"]]) {
    test(`${designType} insert stores the result id of an agent message in ${table}`, async () => {
        const { calls, execSQL } = createExecSQL();

        await chatInsertHandlers[designType]({
            ...agentMessage,
            externalServiceResultId: RESULT_ID,
            execSQL,
        });

        assert.equal(calls.length, 1);
        assert.match(calls[0].sql, new RegExp(`^INSERT INTO ${table} \\(`));
        assert.match(calls[0].sql, /external_service_result_id \) VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7\)/);
        assert.match(calls[0].sql, /RETURNING .*external_service_result_id$/);
        assert.equal(calls[0].params.length, 7);
        assert.equal(calls[0].params[1], 9);
        assert.equal(calls[0].params[6], RESULT_ID);
    });

    test(`${designType} insert stores NULL for a student's message`, async () => {
        const { calls, execSQL } = createExecSQL();

        await chatInsertHandlers[designType]({ ...studentMessage, execSQL });

        assert.equal(calls[0].params[0], 5);
        assert.equal(calls[0].params[1], null);
        assert.equal(calls[0].params[6], null);
    });
}

test("normalizeExternalServiceResultId accepts uuids only", () => {
    assert.equal(normalizeExternalServiceResultId(RESULT_ID), RESULT_ID);
    assert.equal(normalizeExternalServiceResultId(` ${RESULT_ID.toUpperCase()} `), RESULT_ID);
    assert.equal(normalizeExternalServiceResultId(null), null);
    assert.equal(normalizeExternalServiceResultId(undefined), null);
    assert.equal(normalizeExternalServiceResultId(42), null);
    assert.equal(normalizeExternalServiceResultId("not-a-uuid"), null);
    assert.equal(normalizeExternalServiceResultId(`${RESULT_ID}; DROP TABLE chat`), null);
});

function createSaveDependencies(designType = "semantic_differential") {
    const inserted = [];
    const handler = async data => {
        inserted.push(data);
        return { id: inserted.length };
    };
    return {
        inserted,
        dependencies: {
            resolveDesignType: async () => designType,
            insertHandlers:    { [designType]: handler },
        },
    };
}

async function quietly(run) {
    const originalError = console.error;
    console.error = () => {};
    try {
        return await run();
    } finally {
        console.error = originalError;
    }
}

test("saveChatMessage passes an agent message's result id to the insert handler", async () => {
    const { inserted, dependencies } = createSaveDependencies("ranking");

    const saved = await saveChatMessage({
        userId:                  null,
        externalAgentId:         9,
        externalServiceResultId: RESULT_ID,
        phaseId:                 22,
        questionId:              701,
        groupId:                 301,
        content:                 "Hello",
    }, dependencies);

    assert.deepEqual(saved, { id: 1 });
    assert.equal(inserted[0].externalServiceResultId, RESULT_ID);
    assert.equal(inserted[0].externalAgentId, 9);
});

test("saveChatMessage stores NULL for a student's message, flat or nested", async () => {
    const { inserted, dependencies } = createSaveDependencies();

    await saveChatMessage({
        userId:     5,
        phaseId:    22,
        questionId: 701,
        groupId:    301,
        content:    "Hello",
    }, dependencies);
    await saveChatMessage({
        header:  { userId: 5, phaseId: 22, questionId: 701, groupId: 301 },
        payload: { content: "Hello again" },
    }, dependencies);

    assert.equal(inserted.length, 2);
    assert.equal(inserted[0].externalServiceResultId, null);
    assert.equal(inserted[1].externalServiceResultId, null);
});

test("saveChatMessage refuses a result link on a message without an agent", async () => {
    const { inserted, dependencies } = createSaveDependencies();

    const saved = await quietly(() => saveChatMessage({
        userId:                  5,
        externalServiceResultId: RESULT_ID,
        phaseId:                 22,
        questionId:              701,
        groupId:                 301,
        content:                 "Hello",
    }, dependencies));

    assert.equal(saved, false);
    assert.equal(inserted.length, 0);
});

test("saveChatMessage refuses a result id that is not a uuid", async () => {
    const { inserted, dependencies } = createSaveDependencies();

    const saved = await quietly(() => saveChatMessage({
        externalAgentId:         9,
        externalServiceResultId: "not-a-uuid",
        phaseId:                 22,
        questionId:              701,
        groupId:                 301,
        content:                 "Hello",
    }, dependencies));

    assert.equal(saved, false);
    assert.equal(inserted.length, 0);
});
