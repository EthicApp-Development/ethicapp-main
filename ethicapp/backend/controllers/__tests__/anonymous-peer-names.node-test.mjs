// No student-facing response carries a peer's firstname, lastname or name in
// an anonymous phase (#1199). Each endpoint that lists the members of a
// student's group is asked by a student in an anonymous phase, by a student
// in a phase that is not anonymous, and, where the teacher may call it, by
// the activity's teacher, who keeps every name.
//
// PostgreSQL is replaced by a fake pg pool that answers by matching the SQL,
// and the Redis cache client's get, set and del by an in-memory map, so
// nothing here needs a database or Redis.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import activitiesStudentRouter from "../activities/activities-student.js";
import groupMessagesRouter from "../group-messages.js";
import groupsRouter from "../groups.js";
import redisClient from "../../db/redis.js";
import { PHASE_ACCESS_SQL, SESSION_ACCESS_SQL } from "../../helpers/activity-owner-helper.js";
import { GROUP_CHAT_ACCESS_SQL } from "../../helpers/group-chat-access.js";
import { GROUP_MASKS_SQL } from "../../helpers/peer-names.js";
import { STUDENT_ACTIVITY_DESCRIPTOR_SQL } from "../../helpers/student-activity-descriptor.js";
import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";

const OWNER = Object.freeze({ uid: 5, role: "P" });
const STUDENT = Object.freeze({ uid: 9, role: "A" });
const PEER = Object.freeze({ uid: 12, role: "A" });

const USERS = new Map([
    [OWNER.uid, { firstname: "Paula", lastname: "Vera", name: "Paula Vera" }],
    [STUDENT.uid, { firstname: "Ana", lastname: "Soto", name: "Ana Soto" }],
    [PEER.uid, { firstname: "Beto", lastname: "Rojas", name: "Beto Rojas" }],
]);
const PEER_NAMES = Object.freeze(["Beto", "Rojas", "Beto Rojas"]);

const SESSION_ID = 10;
const DESIGN_ID = 1;
const QUESTION_ID = 11;

// Phase 1 shows names; phase 2 is anonymous. The student and their peer
// share one group in each, with different masks.
const PHASES = new Map([
    [100, { number: 1, anon: false, groupId: 31 }],
    [200, { number: 2, anon: true, groupId: 30 }],
]);
const NAMED_PHASE_ID = 100;
const ANONYMOUS_PHASE_ID = 200;
const GROUPS = new Map([
    [31, { phaseId: NAMED_PHASE_ID, masks: new Map([[STUDENT.uid, "B"], [PEER.uid, "A"]]) }],
    [30, { phaseId: ANONYMOUS_PHASE_ID, masks: new Map([[STUDENT.uid, "A"], [PEER.uid, "B"]]) }],
]);

const SD_DESIGN = Object.freeze({
    type:   "semantic_differential",
    phases: [
        { question: "Rate the case.", chat: true, anonymous: false },
        { question: "Rate it again.", chat: true, anonymous: true },
    ],
});

// --- Fake PostgreSQL -------------------------------------------------------

function membersOf(groupId) {
    const group = GROUPS.get(groupId);
    return group
        ? [...group.masks].map(([uid, mask]) => ({ user_id: uid, anon_mask: mask, ...USERS.get(uid) }))
        : [];
}

function groupOf(phaseId, userId) {
    const phase = PHASES.get(phaseId);
    return phase && GROUPS.get(phase.groupId).masks.has(userId) ? phase.groupId : null;
}

function transcriptOf(groupId) {
    return [
        { id: 1, uid: STUDENT.uid, author_role: "A", author_name: "Ana Soto", content: "Hola" },
        { id: 2, uid: PEER.uid, author_role: "A", author_name: "Beto Rojas", content: "Hola, Ana" },
        { id: 3, uid: OWNER.uid, author_role: "P", author_name: "Paula Vera", content: "Bien" },
        {
            id:          4,
            uid:         null,
            author_role: "external_service",
            author_name: "agente",
            content:     "¿Por qué?",
        },
    ].map(message => ({ ...message, group_id: groupId, stime: "2026-11-13T12:00:00Z", parent_id: null }));
}

function rowsFor(sql, params = []) {
    // rpg2.param() sends a JSON string `{"name": value, "type": "plain"}`;
    // other queries send plain values.
    const [first, second, , fourth] = params.map(value => {
        if (typeof value === "string" && value.startsWith("{")) {
            return Number(JSON.parse(value).name);
        }
        return Number(value);
    });

    // Access checks.
    if (sql === PHASE_ACCESS_SQL) {
        return PHASES.has(first)
            ? [{
                phase_id:    first,
                session_id:  SESSION_ID,
                owned:       second === OWNER.uid,
                participant: USERS.has(second),
            }]
            : [];
    }
    if (sql === SESSION_ACCESS_SQL) {
        return [{ session_id: SESSION_ID, owned: second === OWNER.uid, participant: USERS.has(second) }];
    }
    if (sql === GROUP_CHAT_ACCESS_SQL) {
        const group = GROUPS.get(first);
        return group
            ? [{
                group_id:                  first,
                phase_id:                  group.phaseId,
                session_id:                SESSION_ID,
                creator:                   OWNER.uid,
                current_stage:             group.phaseId,
                status:                    2,
                chat:                      true,
                is_group_member:           group.masks.has(fourth),
                question_belongs_to_phase: true,
            }]
            : [];
    }

    // GET /phases/:id/user_group/:user_id
    if (/tu\.uid AS user_id,\s+tu\.anon_mask,\s+st\.anon AS phase_anonymous/u.test(sql)) {
        const groupId = groupOf(first, second);
        return groupId
            ? [{ team_id:         groupId, user_id:         second, anon_mask:       GROUPS.get(groupId).masks.get(second),
                phase_anonymous: PHASES.get(first).anon }]
            : [];
    }
    if (/u\.firstname,\s+u\.lastname,\s+u\.name\s+FROM teamusers AS tu/u.test(sql)) {
        return membersOf(first);
    }

    // The group chat.
    if (/FROM differential_chat AS c/u.test(sql)) {
        return transcriptOf(second);
    }
    if (sql === GROUP_MASKS_SQL) {
        const group = GROUPS.get(first);
        return group
            ? [...group.masks].map(([uid, mask]) => ({
                phase_anonymous: PHASES.get(group.phaseId).anon,
                user_id:         uid,
                anon_mask:       mask,
            }))
            : [];
    }

    // GET /phases/:id/user_group/:user_id/previous_responses
    if (/st\.sesid AS session_id,\s+st\.anon AS phase_anonymous/u.test(sql)) {
        const groupId = groupOf(first, second);
        return groupId
            ? [{ team_id:         groupId, phase_id:        first, session_id:      SESSION_ID,
                phase_anonymous: PHASES.get(first).anon }]
            : [];
    }
    if (/SELECT id AS phase_id,\s+number AS phase_number\s+FROM stages/u.test(sql)) {
        return [{ phase_id: NAMED_PHASE_ID, phase_number: 1 }];
    }
    if (/d\.title AS task_title/u.test(sql)) {
        return [{ phase_number: 1, task_id:      QUESTION_ID, task_title:   "Rate the case.", task_order:   1,
            left_pole:    "No", right_pole:   "Yes", num_values:   7 }];
    }
    if (/FROM differential_selection AS ds\s+INNER JOIN differential AS d/u.test(sql)) {
        return [STUDENT.uid, PEER.uid].map((uid, index) => ({
            phase_number:  1, user_id:       uid, task_id:       QUESTION_ID, selection:     index + 2,
            justification: "Porque sí", timestamp:     "2026-11-13T12:00:00Z",
        }));
    }

    // GET /activities/:id/users/:user_id/full_state
    if (/AS peer_anonymity/u.test(sql)) {
        return [...PHASES.values()].map(phase => ({
            phase_number:    phase.number,
            task_id:         QUESTION_ID,
            selection:       4,
            justification:   "Porque sí",
            timestamp:       "2026-11-13T12:00:00Z",
            phase_id:        [...PHASES].find(([, value]) => value === phase)[0],
            peer_id:         PEER.uid,
            peer_name:       "Beto Rojas",
            peer_anonymity:  GROUPS.get(phase.groupId).masks.get(PEER.uid),
            phase_anonymous: phase.anon,
        }));
    }
    if (sql === STUDENT_ACTIVITY_DESCRIPTOR_SQL) {
        return [{
            description:        "Activity",
            design:             SD_DESIGN,
            currentphasenumber: 2,
            currentphaseid:     ANONYMOUS_PHASE_ID,
        }];
    }
    if (/SELECT d\.design\s+FROM activity a/u.test(sql)) {
        return [{ design: SD_DESIGN }];
    }
    if (/FROM\s+stages st\s+WHERE\s+st\.sesid = \$1/u.test(sql)) {
        return [...PHASES].map(([id, phase]) => ({
            id, number:       phase.number, mode:         "individual", anon:         phase.anon, chat:         true,
            instructions: "Rate the case.",
        }));
    }

    // The design type of a phase or session.
    if (/SELECT sesid\s+FROM stages/u.test(sql)) {
        return [{ sesid: SESSION_ID }];
    }
    if (/SELECT design\s+FROM activity\s+WHERE session = \$1/u.test(sql)) {
        return [{ design: DESIGN_ID }];
    }
    if (/SELECT design\s+FROM designs\s+WHERE id = \$1/u.test(sql)
        || /AS public\s+FROM designs/u.test(sql)) {
        return [{ id: DESIGN_ID, design: SD_DESIGN }];
    }
    if (/st\.sesid AS session_id,\s+d\.design AS design_json/u.test(sql)) {
        return [{ session_id: SESSION_ID, design_json: SD_DESIGN }];
    }
    return [];
}

const db = installFakePgPool(rowsFor);

// --- Fake Redis cache ------------------------------------------------------

const cache = new Map();
redisClient.get = async key => cache.get(key) ?? null;
redisClient.set = async (key, value) => {
    cache.set(key, value);
    return "OK";
};
redisClient.del = async key => (cache.delete(key) ? 1 : 0);

after(() => {
    db.restore();
    delete redisClient.get;
    delete redisClient.set;
    delete redisClient.del;
    redisClient.disconnect();
});

beforeEach(() => {
    db.reset();
    cache.clear();
});

// --- Expectations ----------------------------------------------------------

/** Every string in `body`, at any depth. */
function strings(body) {
    if (typeof body === "string") {
        return [body];
    }
    if (body && typeof body === "object") {
        return Object.values(body).flatMap(strings);
    }
    return [];
}

function assertNoPeerName(body) {
    for (const name of PEER_NAMES) {
        assert.ok(!strings(body).includes(name), `the answer carries the peer's name ${JSON.stringify(name)}`);
    }
}

function assertCarriesPeerName(body) {
    assert.ok(strings(body).includes("Beto Rojas"), "the answer should name the peer");
}

// --- GET /phases/:id/user_group/:user_id -----------------------------------

function userGroup(session, phaseId, userId = session.uid) {
    return requestRouter(groupsRouter, { path: `/phases/${phaseId}/user_group/${userId}`, session });
}

describe("GET /phases/:id/user_group/:user_id", () => {
    it("gives a student in an anonymous phase their peers' masks and no names", async () => {
        const { status, body } = await userGroup(STUDENT, ANONYMOUS_PHASE_ID);

        assert.equal(status, 200);
        assert.equal(body.phase_anonymous, true);
        assert.deepEqual(body.participants, [
            { user_id: STUDENT.uid, anon_mask: "A", firstname: "Ana", lastname: "Soto", name: "Ana Soto" },
            { user_id: PEER.uid, anon_mask: "B", firstname: null, lastname: null, name: null },
        ]);
        assertNoPeerName(body);
    });

    it("names the peers in a phase that is not anonymous", async () => {
        const { status, body } = await userGroup(STUDENT, NAMED_PHASE_ID);

        assert.equal(status, 200);
        assert.equal(body.phase_anonymous, false);
        assert.deepEqual(body.participants.find(participant => participant.user_id === PEER.uid),
            { user_id: PEER.uid, anon_mask: "A", firstname: "Beto", lastname: "Rojas", name: "Beto Rojas" });
    });

    it("names every member for the activity's teacher in an anonymous phase", async () => {
        const { status, body } = await userGroup(OWNER, ANONYMOUS_PHASE_ID, STUDENT.uid);

        assert.equal(status, 200);
        assert.deepEqual(body.participants.map(participant => participant.name), ["Ana Soto", "Beto Rojas"]);
    });
});

// --- GET /groups/:group_id/question/:question_id/chat_messages ------------

function chatMessages(session, groupId) {
    return requestRouter(groupMessagesRouter, {
        path: `/groups/${groupId}/question/${QUESTION_ID}/chat_messages`,
        session,
    });
}

describe("GET /groups/:group_id/question/:question_id/chat_messages", () => {
    it("labels a student's peers by their masks in an anonymous phase", async () => {
        const { status, body } = await chatMessages(STUDENT, PHASES.get(ANONYMOUS_PHASE_ID).groupId);

        assert.equal(status, 200);
        assert.deepEqual(body.chat_transcript.map(message => [message.uid, message.author_name]), [
            [STUDENT.uid, "Ana Soto"],
            [PEER.uid, "B"],
            [OWNER.uid, "Paula Vera"],
            [null, "agente"],
        ]);
        assertNoPeerName(body);
    });

    it("names the peers in a phase that is not anonymous", async () => {
        const { status, body } = await chatMessages(STUDENT, PHASES.get(NAMED_PHASE_ID).groupId);

        assert.equal(status, 200);
        assertCarriesPeerName(body);
    });

    it("names every author for the activity's teacher, without reading the masks", async () => {
        const { status, body } = await chatMessages(OWNER, PHASES.get(ANONYMOUS_PHASE_ID).groupId);

        assert.equal(status, 200);
        assert.deepEqual(body.chat_transcript.map(message => message.author_name),
            ["Ana Soto", "Beto Rojas", "Paula Vera", "agente"]);
        assert.ok(!db.queries.some(({ sql }) => sql === GROUP_MASKS_SQL));
    });
});

// --- GET /phases/:id/user_group/:user_id/previous_responses ---------------

function previousResponses(session, phaseId) {
    return requestRouter(groupsRouter, {
        path: `/phases/${phaseId}/user_group/${session.uid}/previous_responses?phase_numbers=1`,
        session,
    });
}

describe("GET /phases/:id/user_group/:user_id/previous_responses", () => {
    it("gives a student in an anonymous phase their peers' responses without names", async () => {
        const { status, body } = await previousResponses(STUDENT, ANONYMOUS_PHASE_ID);

        assert.equal(status, 200);
        assert.equal(body.phaseAnonymous, true);
        assert.deepEqual(
            body.participants.map(participant => [participant.userId, participant.name, participant.anonMask]),
            [[STUDENT.uid, "Ana Soto", "A"], [PEER.uid, null, "B"]]
        );
        assert.deepEqual(
            body.phases[0].tasks[0].responses.map(response => [response.userId, response.authorName]),
            [[STUDENT.uid, "Ana Soto"], [PEER.uid, null]]
        );
        assertNoPeerName(body);
    });

    it("keeps the rule for a payload read from the cache", async () => {
        await previousResponses(STUDENT, ANONYMOUS_PHASE_ID);
        assert.ok(cache.size > 0, "the first answer is cached");

        const { body } = await previousResponses(STUDENT, ANONYMOUS_PHASE_ID);
        assertNoPeerName(body);
    });

    it("names the peers in a phase that is not anonymous", async () => {
        const { status, body } = await previousResponses(STUDENT, NAMED_PHASE_ID);

        assert.equal(status, 200);
        assertCarriesPeerName(body);
    });
});

// --- GET /activities/:id/users/:user_id/full_state -----------------------

describe("GET /activities/:id/users/:user_id/full_state", () => {
    it("names a peer response's author only in the phases that are not anonymous", async () => {
        const { status, body } = await requestRouter(activitiesStudentRouter, {
            path:    `/activities/${SESSION_ID}/users/${STUDENT.uid}/full_state`,
            session: STUDENT,
        });

        assert.equal(status, 200);
        const peersByPhase = Object.fromEntries(body.state.phases.map(phase => [
            phase.number,
            phase.peerResponses.map(response => response.peer),
        ]));
        assert.deepEqual(peersByPhase, {
            1: [{ id: PEER.uid, name: "Beto Rojas", anonMask: "A" }],
            2: [{ id: PEER.uid, name: null, anonMask: "B" }],
        });
        assert.ok(db.queries.some(({ sql }) => /AS peer_anonymity,\s+st\.anon AS phase_anonymous/u.test(sql)),
            "the peer responses read each phase's flag");
    });
});
