// Integration tests for the chat messages a student's full_state carries
// (#1122), against a real PostgreSQL database with migrations applied. Each
// design type with a group chat (semantic differential, whose messages live in
// differential_chat, and ranking, in chat) gets an activity of two team
// phases, each with two groups that both wrote messages. A student's
// full_state must carry no message of the other group, nor its authors' ids,
// on a first call and on a second one served from the cache. The student's
// chat reads its own group's messages through
// GET /groups/:group_id/question/:question_id/chat_messages, checked here too.
//
// The Redis cache client's get, set and del are replaced by an in-memory map,
// as in the route's guardrail test, so the suite needs PostgreSQL only.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. The test inserts users, designs, sessions, phases,
// groups, items and chat messages, and does not remove them.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";

import { requestRouter } from "../../__tests__/fake-pg-pool.mjs";

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
    ? false
    : "ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.";

if (SKIP_REASON) {
    console.warn(SKIP_REASON);
}

let pool = null;
const query = async (sql, params = []) => (await pool.query(sql, params)).rows;

// The in-memory cache shared by both suites, and the keys each request wrote.
const cache = new Map();
const cacheWrites = [];

// Loaded in before(): the application's database settings are read when its
// modules are imported, so DATABASE_URL must be set first.
let app = null;

async function loadApplication() {
    process.env.DATABASE_URL = DATABASE_URL;
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });

    const [
        { default: activitiesStudentRouter },
        { default: groupMessagesRouter },
        { default: redisClient },
        config,
        rpg2,
    ] = await Promise.all([
        import("../activities-student.js"),
        import("../../group-messages.js"),
        import("../../../db/redis.js"),
        import("../../../config/database.config.js"),
        import("../../../db/rest-pg-2.js"),
    ]);
    // The client starts connecting on import; its own properties below shadow
    // the methods the caches call, so it never needs a server.
    redisClient.disconnect();
    redisClient.get = async (key) => cache.get(key) ?? null;
    redisClient.set = async (key, value) => {
        cacheWrites.push(key);
        cache.set(key, value);
        return "OK";
    };
    redisClient.del = async (key) => (cache.delete(key) ? 1 : 0);

    return {
        activitiesStudentRouter,
        groupMessagesRouter,
        async close() {
            delete redisClient.get;
            delete redisClient.set;
            delete redisClient.del;
            await (await rpg2.getDBInstance(config.dbconnString)).end();
            await pool.end();
        },
    };
}

async function createUser(role) {
    const [user] = await query(`
        INSERT INTO users (name, mail, role)
        VALUES ('Integration user', $1, $2)
        RETURNING id;
    `, [`${randomUUID()}@integration.test`, role]);
    return { uid: user.id, role };
}

// An id free in both stages and actors: the greater of their sequences' next
// values, with both sequences moved to it so neither hands it out again.
async function idForStageAndActor() {
    const [{ id }] = await query(`
        SELECT GREATEST(
            nextval(pg_get_serial_sequence('stages', 'id')),
            nextval(pg_get_serial_sequence('actors', 'id'))
        ) AS id;
    `);
    await query(`
        SELECT setval(pg_get_serial_sequence('stages', 'id'), $1),
               setval(pg_get_serial_sequence('actors', 'id'), $1);
    `, [id]);
    return Number(id);
}

// What each design type stores: the phase's one question (an item of the
// ranking, a question of the semantic differential) and a chat message.
const designTypes = {
    semantic_differential: {
        async createPhase(sessionId, number) {
            const [phase] = await query(`
                INSERT INTO stages (number, type, chat, sesid)
                VALUES ($1, 'team', true, $2)
                RETURNING id;
            `, [number, sessionId]);
            const [question] = await query(`
                INSERT INTO differential (title, tleft, tright, orden, sesid, stageid)
                VALUES ('Integration question', 'Left', 'Right', 1, $1, $2)
                RETURNING id;
            `, [sessionId, phase.id]);
            return { phaseId: phase.id, questionId: question.id };
        },
        async writeMessage({ questionId }, groupId, author, content) {
            await query(`
                INSERT INTO differential_chat (uid, did, tmid, content)
                VALUES ($1, $2, $3, $4);
            `, [author.uid, questionId, groupId, content]);
        },
    },
    ranking: {
        // The phase and its item get the same id. Before #1122, full_state's
        // ranking messages were grouped by phase id and looked up by item id,
        // so they reached the response only for an item whose id was its
        // phase's; the shared id lets this test see them there.
        async createPhase(sessionId, number) {
            const id = await idForStageAndActor();
            await query(`
                INSERT INTO stages (id, number, type, chat, sesid)
                VALUES ($1, $2, 'team', true, $3);
            `, [id, number, sessionId]);
            await query(`
                INSERT INTO actors (id, name, jorder, stageid)
                VALUES ($1, 'Integration item', false, $1);
            `, [id]);
            return { phaseId: id, questionId: id };
        },
        async writeMessage({ phaseId }, groupId, author, content) {
            await query(`
                INSERT INTO chat (sesid, stageid, uid, tmid, content)
                SELECT sesid, id, $2, $3, $4 FROM stages WHERE id = $1;
            `, [phaseId, author.uid, groupId, content]);
        },
    },
};

async function createGroup(sessionId, phaseId, members) {
    const [group] = await query(`
        INSERT INTO teams (sesid, leader, stageid)
        VALUES ($1, $2, $3)
        RETURNING id;
    `, [sessionId, members[0].uid, phaseId]);
    for (const [index, member] of members.entries()) {
        await query(
            "INSERT INTO teamusers (tmid, uid, anon_mask) VALUES ($1, $2, $3);",
            [group.id, member.uid, String.fromCharCode(65 + index)]
        );
    }
    return group.id;
}

// An activity in its second phase, both phases chat phases with groups
// `ours` and `theirs`, each with a message from each group. Its AI services
// are off, so the descriptor reads no AI service policy.
async function createActivity(designType, { teacher, ours, theirs }) {
    const kind = designTypes[designType];
    const design = {
        type:   designType,
        phases: [{ mode: "team", chat: true }, { mode: "team", chat: true }],
    };
    const [designRow] = await query(`
        INSERT INTO designs (creator, design)
        VALUES ($1, $2::jsonb)
        RETURNING id;
    `, [teacher.uid, JSON.stringify(design)]);
    const [session] = await query(`
        INSERT INTO sessions (name, descr, creator, time, status, type, ai_services_enabled)
        VALUES ('Integration session', '', $1, now(), 2, 'R', false)
        RETURNING id;
    `, [teacher.uid]);
    await query(
        "INSERT INTO activity (design, session) VALUES ($1, $2);",
        [designRow.id, session.id]
    );
    for (const user of [teacher, ...ours, ...theirs]) {
        await query("INSERT INTO sesusers (sesid, uid) VALUES ($1, $2);", [session.id, user.uid]);
    }

    const phases = [];
    const ownMessages = [];
    const otherMessages = [];
    for (const number of [1, 2]) {
        const phase = await kind.createPhase(session.id, number);
        phase.ownGroupId = await createGroup(session.id, phase.phaseId, ours);
        phase.otherGroupId = await createGroup(session.id, phase.phaseId, theirs);

        const own = `Own group, phase ${number}, ${randomUUID()}`;
        const other = `Other group, phase ${number}, ${randomUUID()}`;
        await kind.writeMessage(phase, phase.ownGroupId, ours[1], own);
        await kind.writeMessage(phase, phase.otherGroupId, theirs[0], other);
        ownMessages.push(own);
        otherMessages.push(other);
        phases.push(phase);
    }
    await query(
        "UPDATE sessions SET current_stage = $1 WHERE id = $2;",
        [phases[1].phaseId, session.id]
    );
    return { sessionId: session.id, phases, ownMessages, otherMessages };
}

// Every [keys, value] pair of a JSON value's leaves, at any depth: `keys`
// names the object keys on the way to the leaf, without array indexes.
function* leaves(value, keys = []) {
    if (Array.isArray(value)) {
        for (const item of value) {
            yield* leaves(item, keys);
        }
    } else if (value && typeof value === "object") {
        for (const [name, child] of Object.entries(value)) {
            yield* leaves(child, [...keys, name]);
        }
    } else {
        yield [keys, value];
    }
}

// Keys that hold a user id in the student state (`peerId`, `uid`, `userId`
// and the like), and `id` inside a peer, author or user object.
const USER_ID_KEY = /^(?:peer_?id|uid|user_?id|author_?id)$/iu;
const USER_OBJECT_KEY = /^(?:peers?|authors?|users?|participants?|members?)$/iu;

function userIdsIn(body) {
    return [...leaves(body)]
        .filter(([keys, value]) => {
            const [parent, key] = keys.slice(-2);
            return typeof value === "number"
                && (USER_ID_KEY.test(key ?? "")
                    || (key === "id" && USER_OBJECT_KEY.test(parent ?? "")));
        })
        .map(([, value]) => value);
}

function stringsIn(body) {
    return [...leaves(body)]
        .filter(([, value]) => typeof value === "string")
        .map(([, value]) => value);
}

for (const designType of Object.keys(designTypes)) {
    const title = `full_state of a ${designType} activity with group chats`;
    describe(title, { skip: SKIP_REASON }, () => {
        let teacher;
        let student;
        let groupmate;
        let others;
        let activity;
        const responses = [];

        before(async () => {
            app ??= await loadApplication();

            teacher = await createUser("P");
            student = await createUser("A");
            groupmate = await createUser("A");
            others = [await createUser("A"), await createUser("A")];
            activity = await createActivity(designType, {
                teacher,
                ours:   [student, groupmate],
                theirs: others,
            });
        });

        function fullState() {
            cacheWrites.length = 0;
            return requestRouter(app.activitiesStudentRouter, {
                path:    `/activities/${activity.sessionId}/users/${student.uid}/full_state`,
                session: student,
            });
        }

        function assertNoOtherGroupData(body) {
            const strings = stringsIn(body);
            for (const message of activity.otherMessages) {
                assert.ok(
                    !strings.some(value => value.includes(message)),
                    `the other group's message "${message}" is in the response`
                );
            }
            const userIds = userIdsIn(body);
            for (const other of others) {
                assert.ok(
                    !userIds.includes(other.uid),
                    `the other group's member ${other.uid} is in the response`
                );
            }
        }

        it("returns no message of the other group on a first call", async () => {
            const response = await fullState();
            responses.push(response);

            assert.equal(response.status, 200);
            assert.deepEqual(
                response.body.state.phases.map(({ id }) => id).sort((a, b) => a - b),
                activity.phases.map(({ phaseId }) => phaseId)
            );
            assertNoOtherGroupData(response.body);
        });

        it("returns no message of the other group on a call served from the cache", async () => {
            const response = await fullState();
            responses.push(response);

            assert.equal(response.status, 200);
            // Within the cache window: every part of the state was cached by
            // the first call, so this one stores nothing.
            assert.deepEqual(cacheWrites, []);
            assertNoOtherGroupData(response.body);
        });

        it("has no groupMessages in any phase", () => {
            assert.equal(responses.length, 2);
            for (const { body } of responses) {
                for (const phase of body.state.phases) {
                    assert.ok(!Object.hasOwn(phase, "groupMessages"), `phase ${phase.number}`);
                }
            }
        });

        function chatMessages(phase, groupId) {
            return requestRouter(app.groupMessagesRouter, {
                path:    `/groups/${groupId}/question/${phase.questionId}/chat_messages`,
                session: student,
            });
        }

        it("leaves the group chat route returning the student's own group only", async () => {
            for (const [index, phase] of activity.phases.entries()) {
                const own = await chatMessages(phase, phase.ownGroupId);
                assert.equal(own.status, 200);
                assert.deepEqual(
                    own.body.chat_transcript.map(({ uid, content }) => ({ uid, content })),
                    [{ uid: groupmate.uid, content: activity.ownMessages[index] }]
                );

                const other = await chatMessages(phase, phase.otherGroupId);
                assert.equal(other.status, 403);
            }
        });
    });
}

after(async () => {
    await app?.close();
});
