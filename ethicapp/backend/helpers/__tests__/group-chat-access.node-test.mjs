// Group chat access (epic #601, #655): the rules of the chat routes, shared
// with the composing signal handlers. Read with a fake query on every call.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getStatusCode } from "../../../common/modules/session-status.js";
import {
    GROUP_CHAT_ACCESS_SQL,
    resolveGroupChatAccessContext,
    resolveOpenGroupChatContext,
} from "../group-chat-access.js";

const IN_PROGRESS = getStatusCode("in_progress");

// Group 9 of phase 20, the current phase of session 57 (created by teacher 7),
// with chat; student 44 is a member.
function row(overrides = {}) {
    return {
        group_id:                  9,
        phase_id:                  20,
        session_id:                57,
        creator:                   7,
        current_stage:             20,
        status:                    IN_PROGRESS,
        chat:                      true,
        is_group_member:           true,
        question_belongs_to_phase: true,
        ...overrides,
    };
}

function dependencies({ rows = [row()], designType = "semantic_differential" } = {}) {
    const queries = [];
    return {
        queries,
        query: async (request) => {
            queries.push(request);
            return rows;
        },
        loadDesignType: async () => designType,
    };
}

const STUDENT_REQUEST = Object.freeze({ groupId: 9, phaseId: 20, questionId: 30, userId: 44, role: "A" });

describe("resolveGroupChatAccessContext", () => {
    it("reads the group, its phase, the question and the membership with the request's ids", async () => {
        const deps = dependencies();
        const context = await resolveGroupChatAccessContext(STUDENT_REQUEST, deps);

        assert.deepEqual(context, {
            phaseId:    20,
            sessionId:  57,
            groupId:    9,
            designType: "semantic_differential",
            canRead:    true,
            canPost:    true,
        });
        assert.equal(deps.queries.length, 1);
        assert.equal(deps.queries[0].sql, GROUP_CHAT_ACCESS_SQL);
        assert.deepEqual(deps.queries[0].sqlParams, [9, 20, 30, 44]);
        assert.match(GROUP_CHAT_ACCESS_SQL, /^\s*SELECT/u);
    });

    it("passes a null phase when the request names none", async () => {
        const deps = dependencies();
        await resolveGroupChatAccessContext({ groupId: "9", questionId: "30", userId: 44, role: "A" }, deps);
        assert.deepEqual(deps.queries[0].sqlParams, [9, null, 30, 44]);
    });

    it("answers null for an unknown group or a group of another phase", async () => {
        assert.equal(await resolveGroupChatAccessContext(STUDENT_REQUEST, dependencies({ rows: [] })), null);
    });

    it("answers null for a question of another semantic differential phase, and ignores it for ranking", async () => {
        const otherQuestion = [row({ question_belongs_to_phase: false })];
        assert.equal(await resolveGroupChatAccessContext(
            STUDENT_REQUEST, dependencies({ rows: otherQuestion })), null);

        const ranking = await resolveGroupChatAccessContext(
            STUDENT_REQUEST, dependencies({ rows: otherQuestion, designType: "ranking" }));
        assert.equal(ranking.canPost, true);
    });

    it("lets members and the activity's teacher read, and nobody else", async () => {
        const nonMember = await resolveGroupChatAccessContext(
            STUDENT_REQUEST, dependencies({ rows: [row({ is_group_member: false })] }));
        assert.equal(nonMember.canRead, false);
        assert.equal(nonMember.canPost, false);

        const owner = await resolveGroupChatAccessContext(
            { ...STUDENT_REQUEST, userId: 7, role: "P" }, dependencies({ rows: [row({ is_group_member: false })] }));
        assert.equal(owner.canPost, true);

        const otherTeacher = await resolveGroupChatAccessContext(
            { ...STUDENT_REQUEST, userId: 8, role: "P" }, dependencies());
        assert.equal(otherTeacher.canRead, false);

        const memberAsTeacher = await resolveGroupChatAccessContext(
            { ...STUDENT_REQUEST, role: "P" }, dependencies());
        assert.equal(memberAsTeacher.canRead, false, "membership counts for role A only");
    });

    it("lets nobody post when the phase has no chat, is not current or the session is not in progress", async () => {
        for (const overrides of [
            { chat: false },
            { current_stage: 21 },
            { status: getStatusCode("finished") },
        ]) {
            const context = await resolveGroupChatAccessContext(
                STUDENT_REQUEST, dependencies({ rows: [row(overrides)] }));
            assert.equal(context.canRead, true);
            assert.equal(context.canPost, false, JSON.stringify(overrides));
        }
    });
});

describe("resolveOpenGroupChatContext", () => {
    it("answers the context only when the writer may post now", async () => {
        const open = await resolveOpenGroupChatContext(STUDENT_REQUEST, dependencies());
        assert.equal(open.sessionId, 57);

        assert.equal(await resolveOpenGroupChatContext(
            STUDENT_REQUEST, dependencies({ rows: [row({ current_stage: 21 })] })), null);
        assert.equal(await resolveOpenGroupChatContext(
            STUDENT_REQUEST, dependencies({ rows: [row({ is_group_member: false })] })), null);
        assert.equal(await resolveOpenGroupChatContext(STUDENT_REQUEST, dependencies({ rows: [] })), null);
    });

    it("requires a phase, so the group must belong to it", async () => {
        const deps = dependencies();
        assert.equal(await resolveOpenGroupChatContext({ ...STUDENT_REQUEST, phaseId: null }, deps), null);
        assert.equal(deps.queries.length, 0);
    });
});
