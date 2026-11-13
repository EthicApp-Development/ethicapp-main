// What a student may learn about the members of their group (#1199): in an
// anonymous phase, their peers' masks and never their names.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    GROUP_MASKS_SQL,
    chatTranscriptForStudent,
    groupParticipantsForStudent,
    loadGroupMasks,
    peerOfResponse,
    previousGroupResponsesForStudent,
    studentSeesPeerNames,
} from "../peer-names.js";

const VIEWER = 7;
const PEER = 8;

describe("studentSeesPeerNames", () => {
    it("shows a peer's names only in a phase whose flag is false", () => {
        assert.equal(studentSeesPeerNames({ viewerId: VIEWER, peerId: PEER, phaseAnonymous: false }), true);
        for (const phaseAnonymous of [true, undefined, null, "false", 0]) {
            assert.equal(
                studentSeesPeerNames({ viewerId: VIEWER, peerId: PEER, phaseAnonymous }),
                false,
                `phaseAnonymous ${String(phaseAnonymous)}`
            );
        }
    });

    it("always shows the student their own names", () => {
        assert.equal(studentSeesPeerNames({ viewerId: VIEWER, peerId: VIEWER, phaseAnonymous: true }), true);
        assert.equal(studentSeesPeerNames({ viewerId: "7", peerId: 7, phaseAnonymous: true }), true);
    });

    it("never matches a missing viewer with a missing peer", () => {
        assert.equal(studentSeesPeerNames({ viewerId: undefined, peerId: undefined, phaseAnonymous: true }), false);
        assert.equal(studentSeesPeerNames({ viewerId: 0, peerId: 0, phaseAnonymous: true }), false);
    });
});

describe("groupParticipantsForStudent", () => {
    const participants = [
        { user_id: VIEWER, anon_mask: "A", firstname: "Ana", lastname: "Soto", name: "Ana Soto" },
        { user_id: PEER, anon_mask: "B", firstname: "Beto", lastname: "Rojas", name: "Beto Rojas" },
    ];

    it("clears the peers' names in an anonymous phase and keeps the masks and the student's own", () => {
        assert.deepEqual(groupParticipantsForStudent(participants, { viewerId: VIEWER, phaseAnonymous: true }), [
            participants[0],
            { user_id: PEER, anon_mask: "B", firstname: null, lastname: null, name: null },
        ]);
        assert.equal(participants[1].name, "Beto Rojas", "the input is not changed");
    });

    it("keeps every name in a phase that is not anonymous", () => {
        assert.deepEqual(
            groupParticipantsForStudent(participants, { viewerId: VIEWER, phaseAnonymous: false }),
            participants
        );
    });
});

describe("chatTranscriptForStudent", () => {
    const messages = [
        { id: 1, uid: VIEWER, author_role: "A", author_name: "Ana Soto", content: "Hola" },
        { id: 2, uid: PEER, author_role: "A", author_name: "Beto Rojas", content: "Hola" },
        { id: 3, uid: 9, author_role: "A", author_name: "Carla Díaz", content: "Ya no estoy" },
        { id: 4, uid: 5, author_role: "P", author_name: "Profesora", content: "Bien" },
        { id: 5, uid: null, author_role: "external_service", author_name: "agente", content: "¿Y?" },
    ];
    const masksByUserId = new Map([[VIEWER, "A"], [PEER, " B "]]);

    it("labels the peers by their masks in an anonymous phase", () => {
        const transcript = chatTranscriptForStudent(messages, {
            viewerId:       VIEWER,
            phaseAnonymous: true,
            masksByUserId,
        });

        assert.deepEqual(transcript.map(message => message.author_name), [
            "Ana Soto",
            "B",
            null,
            "Profesora",
            "agente",
        ]);
        assert.equal(messages[1].author_name, "Beto Rojas", "the input is not changed");
    });

    it("keeps every author name in a phase that is not anonymous", () => {
        assert.deepEqual(
            chatTranscriptForStudent(messages, { viewerId: VIEWER, phaseAnonymous: false, masksByUserId }),
            messages
        );
    });
});

describe("previousGroupResponsesForStudent", () => {
    const payload = {
        groupId:        3,
        phaseAnonymous: true,
        participants:   [
            { userId: VIEWER, name: "Ana Soto", anonMask: "A", isSelf: true },
            { userId: PEER, name: "Beto Rojas", anonMask: "B", isSelf: false },
        ],
        phases: [{
            phaseNumber: 1,
            tasks:       [{
                taskId:    11,
                responses: [
                    { userId: VIEWER, authorName: "Ana Soto", anonMask: "A", isSelf: true, selection: 2 },
                    { userId: PEER, authorName: "Beto Rojas", anonMask: "B", isSelf: false, selection: 5 },
                ],
            }],
        }],
    };

    it("clears the peers' names in an anonymous phase", () => {
        const seen = previousGroupResponsesForStudent(payload, VIEWER);

        assert.deepEqual(seen.participants.map(participant => participant.name), ["Ana Soto", null]);
        assert.deepEqual(
            seen.phases[0].tasks[0].responses.map(response => [response.authorName, response.anonMask]),
            [["Ana Soto", "A"], [null, "B"]]
        );
        assert.equal(payload.participants[1].name, "Beto Rojas", "the input is not changed");
    });

    it("clears them too in a payload without the flag", () => {
        const withoutFlag = { ...payload };
        delete withoutFlag.phaseAnonymous;
        const seen = previousGroupResponsesForStudent(withoutFlag, VIEWER);

        assert.deepEqual(seen.participants.map(participant => participant.name), ["Ana Soto", null]);
    });

    it("keeps every name in a phase that is not anonymous", () => {
        const open = { ...payload, phaseAnonymous: false };
        assert.deepEqual(previousGroupResponsesForStudent(open, VIEWER), open);
    });
});

describe("peerOfResponse", () => {
    const row = { peer_id: PEER, peer_name: "Beto Rojas", peer_anonymity: "B" };

    it("names the peer only when the phase they shared is not anonymous", () => {
        assert.deepEqual(peerOfResponse({ ...row, phase_anonymous: false }),
            { id: PEER, name: "Beto Rojas", anonMask: "B" });
        for (const phaseAnonymous of [true, null, undefined]) {
            assert.deepEqual(peerOfResponse({ ...row, phase_anonymous: phaseAnonymous }),
                { id: PEER, name: null, anonMask: "B" });
        }
    });
});

describe("loadGroupMasks", () => {
    it("reads the phase's flag and the members' masks of the group", async () => {
        const calls = [];
        const query = async (request) => {
            calls.push(request);
            return [
                { phase_anonymous: true, user_id: VIEWER, anon_mask: "A" },
                { phase_anonymous: true, user_id: PEER, anon_mask: null },
            ];
        };

        const { phaseAnonymous, masksByUserId } = await loadGroupMasks("3", query);

        assert.equal(calls[0].sql, GROUP_MASKS_SQL);
        assert.equal(JSON.parse(calls[0].sqlParams[0]).name, 3);
        assert.equal(phaseAnonymous, true);
        assert.deepEqual([...masksByUserId], [[VIEWER, "A"], [PEER, null]]);
    });

    it("treats a group without members by its phase, and an unknown group as anonymous", async () => {
        const empty = await loadGroupMasks(3, async () => [
            { phase_anonymous: false, user_id: null, anon_mask: null },
        ]);
        assert.equal(empty.phaseAnonymous, false);
        assert.equal(empty.masksByUserId.size, 0);

        const unknown = await loadGroupMasks(3, async () => []);
        assert.equal(unknown.phaseAnonymous, true);
    });
});
