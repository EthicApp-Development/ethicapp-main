// The chat author label (epic #601, #654): what the composing notice says
// about its writer. It never carries a real name in an anonymous phase.
import assert from "node:assert/strict";
import test from "node:test";

import {
    chatAuthorLabel,
    loadChatAuthorIdentity,
    resolveChatAuthorLabel,
} from "../chat-author-label.js";

const ANA = Object.freeze({ anon_mask: "B", firstname: " Ana ", lastname: "Rojas ", name: "arojas" });

test("a participant in a phase that is not anonymous is labelled with their full name", () => {
    assert.deepEqual(
        chatAuthorLabel({ userId: 7, role: "A", phaseAnonymous: false, participant: ANA }),
        { userId: 7, role: "A", name: "Ana Rojas" }
    );
    assert.deepEqual(
        chatAuthorLabel({
            userId:         7,
            role:           "A",
            phaseAnonymous: false,
            participant:    { ...ANA, lastname: null },
        }).name,
        "Ana"
    );
});

test("without a first or last name the label falls back to the name, then to null", () => {
    assert.equal(chatAuthorLabel({
        userId:         7,
        role:           "A",
        phaseAnonymous: false,
        participant:    { firstname: " ", lastname: "", name: " arojas " },
    }).name, "arojas");
    assert.equal(chatAuthorLabel({
        userId:         7,
        role:           "A",
        phaseAnonymous: false,
        participant:    { firstname: null, lastname: null, name: "" },
    }).name, null);
    assert.equal(chatAuthorLabel({ userId: 7, role: "A", phaseAnonymous: false }).name, null);
});

test("a participant in an anonymous phase is labelled with their mask, never their name", () => {
    const label = chatAuthorLabel({ userId: 7, role: "A", phaseAnonymous: true, participant: ANA });

    assert.deepEqual(label, { userId: 7, role: "A", name: "B" });
    assert.ok(Object.isFrozen(label));
});

test("a participant without a mask in an anonymous phase has no name", () => {
    for (const anonMask of [null, undefined, "", "  "]) {
        const label = chatAuthorLabel({
            userId:         7,
            role:           "A",
            phaseAnonymous: true,
            participant:    { ...ANA, anon_mask: anonMask },
        });
        assert.deepEqual(label, { userId: 7, role: "A", name: null });
    }
});

test("a phase whose anonymity is not a strict false counts as anonymous", () => {
    for (const phaseAnonymous of [undefined, null, "false", 0]) {
        const label = chatAuthorLabel({ userId: 7, role: "A", phaseAnonymous, participant: ANA });
        assert.equal(label.name, "B", `phaseAnonymous ${String(phaseAnonymous)}`);
    }
});

test("the teacher has no name, whatever the phase", () => {
    for (const phaseAnonymous of [true, false]) {
        assert.deepEqual(
            chatAuthorLabel({ userId: 3, role: "P", phaseAnonymous, participant: ANA }),
            { userId: 3, role: "P", name: null }
        );
    }
});

test("a label needs a positive integer user id and the role A or P", () => {
    assert.throws(() => chatAuthorLabel({ userId: 0, role: "A", phaseAnonymous: false }), TypeError);
    assert.throws(() => chatAuthorLabel({ userId: "7", role: "A", phaseAnonymous: false }), TypeError);
    for (const role of ["S", "external_service", undefined]) {
        assert.throws(() => chatAuthorLabel({ userId: 7, role, phaseAnonymous: false }), TypeError);
    }
});

test("loadChatAuthorIdentity reads one member of one group", async () => {
    const calls = [];
    const query = async (request) => {
        calls.push(request);
        return [{ anon_mask: "C", firstname: "Ana", lastname: "Rojas", name: "arojas", phase_anonymous: true }];
    };

    const identity = await loadChatAuthorIdentity({ groupId: 12, userId: 7 }, query);

    assert.deepEqual(identity, {
        phaseAnonymous: true,
        participant:    { anon_mask: "C", firstname: "Ana", lastname: "Rojas", name: "arojas" },
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].sqlParams.map(param => JSON.parse(param).name), [12, 7]);
    assert.match(calls[0].sql, /WHERE tu\.tmid = \$1\s+AND tu\.uid = \$2/u);
    assert.match(calls[0].sql, /st\.anon AS phase_anonymous/u);
});

test("loadChatAuthorIdentity answers null for a user outside the group", async () => {
    assert.equal(await loadChatAuthorIdentity({ groupId: 12, userId: 99 }, async () => []), null);
});

test("loadChatAuthorIdentity treats only a true flag as anonymous, as the student app does", async () => {
    const identity = await loadChatAuthorIdentity(
        { groupId: 12, userId: 7 },
        async () => [{ anon_mask: null, firstname: "Ana", lastname: null, name: null, phase_anonymous: null }]
    );
    assert.equal(identity.phaseAnonymous, false);
});

test("resolveChatAuthorLabel reads nothing for the teacher", async () => {
    let reads = 0;
    const label = await resolveChatAuthorLabel(
        { groupId: 12, userId: 3, role: "P" },
        { loadIdentity: async () => { reads += 1; return null; } }
    );

    assert.deepEqual(label, { userId: 3, role: "P", name: null });
    assert.equal(reads, 0);
});

test("resolveChatAuthorLabel labels a participant from their identity in the group", async () => {
    const asked = [];
    const loadIdentity = async (member) => {
        asked.push(member);
        return { phaseAnonymous: true, participant: ANA };
    };

    assert.deepEqual(
        await resolveChatAuthorLabel({ groupId: 12, userId: 7, role: "A" }, { loadIdentity }),
        { userId: 7, role: "A", name: "B" }
    );
    assert.deepEqual(asked, [{ groupId: 12, userId: 7 }]);
});

test("resolveChatAuthorLabel answers null for a participant outside the group", async () => {
    assert.equal(
        await resolveChatAuthorLabel({ groupId: 12, userId: 99, role: "A" }, { loadIdentity: async () => null }),
        null
    );
});

test("resolveChatAuthorLabel refuses an invalid author before reading", async () => {
    let reads = 0;
    const loadIdentity = async () => { reads += 1; return null; };

    await assert.rejects(resolveChatAuthorLabel({ groupId: 12, userId: 7, role: "S" }, { loadIdentity }), TypeError);
    await assert.rejects(resolveChatAuthorLabel({ groupId: 12, userId: -1, role: "A" }, { loadIdentity }), TypeError);
    assert.equal(reads, 0);
});
