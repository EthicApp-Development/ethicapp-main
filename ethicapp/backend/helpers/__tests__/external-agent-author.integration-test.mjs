// Integration tests for the author name of external agents' chat messages
// (#1026, epic #1025), against a real PostgreSQL database with migrations
// applied. The group chat transcripts (helpers/chat-helper.js, both design
// types) and the semantic differential report transcript read a message's
// per-room name from the callback result it links to
// (helpers/external-agent-author.js):
//
// - the result's adapter_result.payload.publishedMessages[].displayName;
// - while the result has no published messages yet, raw_payload's
//   evaluation of the message's agent;
// - nothing for a result of an anonymized user, whose strings V31 redacts,
//   nor for a result completed before #1026, so those messages keep the
//   agent row's name.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. The test inserts users, a design, a session,
// phases, a group, an agent row, callback results and chat messages, and does
// not remove them.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
    ? false
    : "ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.";

if (SKIP_REASON) {
    console.warn(SKIP_REASON);
}

const CANONICAL = "ConversationGuide";
const LONG_NAME = "n".repeat(120);

let pool = null;
let app = null;
const query = async (sql, params = []) => (await pool.query(sql, params)).rows;

async function loadApplication() {
    // The application's database settings are read when its modules are
    // imported, so DATABASE_URL must be set first.
    process.env.DATABASE_URL = DATABASE_URL;
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
    const [chatHelper, reportQueries, config, rpg2] = await Promise.all([
        import("../chat-helper.js"),
        import("../../controllers/activities/report-query-builders.js"),
        import("../../config/database.config.js"),
        import("../../db/rest-pg-2.js"),
    ]);
    return {
        chatTranscriptHandlers: chatHelper.chatTranscriptHandlers,
        reportSql:              reportQueries.buildSemanticDifferentialChatTranscriptSql(),
        async close() {
            await (await rpg2.getDBInstance(config.dbconnString)).end();
            await pool.end();
        },
    };
}

async function createUser(role, name) {
    const [user] = await query(`
        INSERT INTO users (name, mail, role)
        VALUES ($1, $2, $3)
        RETURNING id;
    `, [name, `${randomUUID()}@integration.test`, role]);
    return user.id;
}

// A callback result as the external-services layer stores it: raw payload on
// arrival, adapter_result once the handler completed (null before).
async function createResult({ serviceId, userId = null, evaluations }) {
    const [result] = await query(`
        INSERT INTO external_service_results (service_id, user_id, raw_payload)
        VALUES ($1, $2, $3::jsonb)
        RETURNING id;
    `, [serviceId, userId, JSON.stringify({ room: "integration-room", evaluations })]);
    return result.id;
}

async function completeResult(resultId, publishedMessages) {
    await query(`
        UPDATE external_service_results
        SET status = 'completed',
            adapter_result = $2::jsonb
        WHERE id = $1;
    `, [resultId, JSON.stringify({
        hook:    "callback-received",
        status:  "completed",
        payload: { publishedMessages },
    })]);
}

// The rows of one design type's chat, and of its transcript query. Each call
// adds a phase to the one session, so phases are numbered in order.
let phaseNumber = 0;
const designTypes = {
    semantic_differential: {
        async createPhase(sessionId) {
            const [phase] = await query(`
                INSERT INTO stages (number, type, chat, sesid)
                VALUES ($2, 'team', true, $1)
                RETURNING id;
            `, [sessionId, ++phaseNumber]);
            const [question] = await query(`
                INSERT INTO differential (title, tleft, tright, orden, sesid, stageid)
                VALUES ('Integration question', 'Left', 'Right', 1, $1, $2)
                RETURNING id;
            `, [sessionId, phase.id]);
            return { phaseId: phase.id, questionId: question.id };
        },
        async writeMessage({ questionId }, groupId, { userId = null, agentId = null, resultId = null }, content) {
            const [message] = await query(`
                INSERT INTO differential_chat (uid, external_agent_id, external_service_result_id, did, tmid, content)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id;
            `, [userId, agentId, resultId, questionId, groupId, content]);
            return message.id;
        },
    },
    ranking: {
        async createPhase(sessionId) {
            const [phase] = await query(`
                INSERT INTO stages (number, type, chat, sesid)
                VALUES ($2, 'team', true, $1)
                RETURNING id;
            `, [sessionId, ++phaseNumber]);
            return { phaseId: phase.id, questionId: phase.id };
        },
        async writeMessage({ phaseId }, groupId, { userId = null, agentId = null, resultId = null }, content) {
            const [message] = await query(`
                INSERT INTO chat (sesid, stageid, uid, external_agent_id, external_service_result_id, tmid, content)
                SELECT sesid, id, $2, $3, $4, $5, $6 FROM stages WHERE id = $1
                RETURNING id;
            `, [phaseId, userId, agentId, resultId, groupId, content]);
            return message.id;
        },
    },
};

describe("external agent author names", { skip: SKIP_REASON }, () => {
    let fixture = null;

    before(async () => {
        app = await loadApplication();

        const teacher = await createUser("P", "Integration teacher");
        const student = await createUser("A", "Integration student");
        const forgotten = await createUser("A", "Forgotten student");
        await query("UPDATE users SET anonymized_at = now() WHERE id = $1;", [forgotten]);

        const [session] = await query(`
            INSERT INTO sessions (name, descr, creator, time, status, type, ai_services_enabled)
            VALUES ('Integration session', '', $1, now(), 2, 'T', true)
            RETURNING id;
        `, [teacher]);
        const serviceId = `polyadic-integration-${randomUUID()}`;
        const [agent] = await query(`
            INSERT INTO external_service_agents (service_id, display_name)
            VALUES ($1, $2)
            RETURNING id;
        `, [serviceId, CANONICAL]);

        fixture = { teacher, student, forgotten, sessionId: session.id, serviceId, agentId: agent.id };
    });

    after(async () => {
        await app?.close();
    });

    // Writes one message per case into the design type's chat, in order, and
    // returns their ids with the author name each must show.
    async function writeCases(designType) {
        const kind = designTypes[designType];
        const phase = await kind.createPhase(fixture.sessionId);
        const [group] = await query(`
            INSERT INTO teams (sesid, leader, stageid)
            VALUES ($1, $2, $3)
            RETURNING id;
        `, [fixture.sessionId, fixture.student, phase.phaseId]);
        await query(
            "INSERT INTO teamusers (tmid, uid, anon_mask) VALUES ($1, $2, 'A'), ($1, $3, 'B');",
            [group.id, fixture.student, fixture.forgotten]
        );

        const { serviceId, agentId } = fixture;
        const guide = (displayName) => ({ agente: CANONICAL, respuesta: "A reply", display_name: displayName });
        const agentMessage = async (resultId, content) =>
            kind.writeMessage(phase, group.id, { agentId, resultId }, content);
        const expected = [];

        // A student's message keeps the student's name.
        expected.push([
            await kind.writeMessage(phase, group.id, { userId: fixture.student }, "Student message"),
            "Integration student",
        ]);

        // Completed: the published message's displayName.
        const completed = await createResult({ serviceId, evaluations: [guide("agente")] });
        const completedMessage = await agentMessage(completed, "Completed");
        await completeResult(completed, [
            { messageId: completedMessage, agentName: CANONICAL, displayName: "agente", evaluationIndex: 0 },
        ]);
        expected.push([completedMessage, "agente"]);

        // Still being handled: the raw evaluation of the message's agent.
        const pending = await createResult({ serviceId, evaluations: [guide("  agent  ")] });
        expected.push([await agentMessage(pending, "Pending"), "agent"]);

        // Still being handled, with a name longer than 80 characters.
        const long = await createResult({ serviceId, evaluations: [guide(LONG_NAME)] });
        expected.push([await agentMessage(long, "Long"), "n".repeat(80)]);

        // Completed before #1026: no displayName, so the agent row's name,
        // even though the raw payload has a display_name.
        const legacy = await createResult({ serviceId, evaluations: [guide("@agente")] });
        const legacyMessage = await agentMessage(legacy, "Legacy");
        await completeResult(legacy, [{ messageId: legacyMessage, agentName: CANONICAL, evaluationIndex: 0 }]);
        expected.push([legacyMessage, CANONICAL]);

        // A reactive reply to the anonymized student: V31 redacts the result's
        // strings on insert and on update, so the agent row's name.
        const redacted = await createResult({
            serviceId, userId: fixture.forgotten, evaluations: [guide("agente")],
        });
        const redactedMessage = await agentMessage(redacted, "Redacted");
        await completeResult(redacted, [
            { messageId: redactedMessage, agentName: CANONICAL, displayName: "agente", evaluationIndex: 0 },
        ]);
        const [stored] = await query(`
            SELECT adapter_result -> 'payload' -> 'publishedMessages' -> 0 ->> 'displayName' AS published,
                   raw_payload -> 'evaluations' -> 0 ->> 'display_name' AS raw
            FROM external_service_results
            WHERE id = $1;
        `, [redacted]);
        // The trigger replaced the names with the placeholder, as the case assumes.
        assert.notEqual(stored.published, "agente");
        assert.notEqual(stored.raw, "agente");
        expected.push([redactedMessage, CANONICAL]);

        // Redacted while still being handled: the raw payload is ignored too.
        const redactedPending = await createResult({
            serviceId, userId: fixture.forgotten, evaluations: [guide("agente")],
        });
        expected.push([await agentMessage(redactedPending, "Redacted pending"), CANONICAL]);

        // Published outside a callback: the agent row's name.
        expected.push([await agentMessage(null, "Unlinked"), CANONICAL]);

        // Another message of a completed result that published two.
        const twoMessages = await createResult({
            serviceId, evaluations: [guide("Profe Ana"), guide("Profe Ana")],
        });
        const first = await agentMessage(twoMessages, "First of two");
        const second = await agentMessage(twoMessages, "Second of two");
        await completeResult(twoMessages, [
            { messageId: first, agentName: CANONICAL, displayName: "Profe Ana", evaluationIndex: 0 },
            { messageId: second, agentName: CANONICAL, displayName: "Profe Ana", evaluationIndex: 1 },
        ]);
        expected.push([first, "Profe Ana"], [second, "Profe Ana"]);

        return { phase, groupId: group.id, expected };
    }

    for (const designType of Object.keys(designTypes)) {
        it(`shows each ${designType} message's author name in the group chat transcript`, async () => {
            const { phase, groupId, expected } = await writeCases(designType);

            const transcript = await app.chatTranscriptHandlers[designType](groupId, phase.questionId);

            const byId = new Map(transcript.map(row => [Number(row.id), row]));
            for (const [messageId, name] of expected) {
                assert.equal(byId.get(Number(messageId))?.author_name, name, `message ${messageId}`);
            }
            const agentRows = transcript.filter(row => row.author_role === "external_service");
            assert.equal(agentRows.length, expected.length - 1);
            assert.ok(agentRows.every(row => row.external_service_id === fixture.serviceId));
        });
    }

    it("shows each message's author name in the semantic differential report transcript", async () => {
        const { expected } = await writeCases("semantic_differential");

        const rows = await query(app.reportSql, [fixture.sessionId]);

        const byId = new Map(rows.map(row => [Number(row.id), row]));
        for (const [messageId, name] of expected) {
            assert.equal(byId.get(Number(messageId))?.name, name, `message ${messageId}`);
        }
    });
});
