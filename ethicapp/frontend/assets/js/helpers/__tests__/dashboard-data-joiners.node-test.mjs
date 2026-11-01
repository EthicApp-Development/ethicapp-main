import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { phaseResponseCounts } from "../activity-dashboard.js";
import { DashboardDataJoiners } from "../dashboard-data-joiners.js";

const phaseDescriptor = {
    number:    1,
    questions: [{ id: 11, number: 1 }],
};

describe("dashboard data joiners", () => {
    it("replaces ranking chat totals when refreshing existing phase data", () => {
        const users = [{ id: 1, name: "Ada", role: "A" }];
        const chats = [{ userId: 1, messageCount: 3 }];

        const initialState = DashboardDataJoiners.ranking.joinPhaseData(
            phaseDescriptor, [], users, chats
        );
        const refreshedState = DashboardDataJoiners.ranking.joinPhaseData(
            phaseDescriptor, [], users, chats, initialState
        );

        assert.equal(refreshedState[0].chatCount, 3);

        const updatedState = DashboardDataJoiners.ranking.joinPhaseData(
            phaseDescriptor, [], users, [{ userId: 1, messageCount: 4 }], refreshedState
        );

        assert.equal(updatedState[0].chatCount, 4);
    });

    it("replaces external group chat totals when refreshing group statistics", () => {
        const phaseState = [{
            userId:      1,
            userName:    "Ada",
            groupId:     7,
            groupNumber: 1,
        }];
        const chats = [{
            userId:       2,
            teamId:       7,
            questionId:   11,
            messageCount: 5,
        }];

        DashboardDataJoiners.semantic_differential.addExternalGroupChatInfo(
            phaseState, chats, phaseDescriptor.questions
        );
        const firstRefresh = DashboardDataJoiners.semantic_differential.updateGroupStatistics(
            phaseState, () => "Group"
        );

        DashboardDataJoiners.semantic_differential.addExternalGroupChatInfo(
            firstRefresh, chats, phaseDescriptor.questions
        );
        const secondRefresh = DashboardDataJoiners.semantic_differential.updateGroupStatistics(
            firstRefresh, () => "Group"
        );
        const groupSummary = secondRefresh.find(user => user.groupStatistics);

        assert.equal(groupSummary.chatR1, 5);
        assert.equal(groupSummary.totalChatCount, 5);
    });

    it("builds ranking phase data when the phase has chat disabled", () => {
        // The dashboard passes null chat statistics for phases without chat.
        const users = [{ id: 1, name: "Ada", role: "A" }];
        const responses = [{ uid: 1, actorid: 11, orden: 2, description: "Because" }];

        const state = DashboardDataJoiners.ranking.joinPhaseData(
            phaseDescriptor, responses, users, null
        );

        assert.equal(state.length, 1);
        assert.equal(state[0].chatCount, 0);
    });

    it("builds semantic differential phase data when the phase has chat disabled", () => {
        const users = [{ id: 1, name: "Ada", role: "A" }];

        const state = DashboardDataJoiners.semantic_differential.joinPhaseData(
            phaseDescriptor, [], users, null
        );

        assert.equal(state.length, 1);
        assert.equal(state[0].userId, 1);
    });

    it("gives each group member their letter within the group (#897)", () => {
        const state = [
            { userId: 1, userName: "Ada" },
            { userId: 2, userName: "Bruno" },
            { userId: 3, userName: "Cleo" },
        ];
        const groups = [{
            id:           7,
            number:       1,
            participants: [1, 2],
            members:      [{ id: 1, anon_mask: "B" }, { id: 2, anon_mask: "A" }],
        }];

        const rows = DashboardDataJoiners.semantic_differential.addGroupInfo(state, groups);

        assert.deepEqual(rows.map(row => [row.userId, row.groupNumber, row.groupLetter]),
            [[1, 1, "B"], [2, 1, "A"], [3, null, null]]);
    });

    it("leaves the letters out when the groups carry no members", () => {
        const rows = DashboardDataJoiners.semantic_differential.addGroupInfo(
            [{ userId: 1, userName: "Ada" }], [{ id: 7, number: 1, participants: [1] }]
        );
        assert.equal(rows[0].groupId, 7);
        assert.equal(rows[0].groupLetter, null);
    });

    // The answered count (#952) reads a row's answer keys: every participant
    // needs one per question or position, answered or not.
    describe("answer keys for the answered count", () => {
        const users = [
            { id: 1, name: "Ada", role: "A" },
            { id: 2, name: "Bruno", role: "A" },
            { id: 3, name: "Cleo", role: "A" },
            { id: 9, name: "Teacher", role: "P" },
        ];
        const sd = DashboardDataJoiners.semantic_differential;
        const ranking = DashboardDataJoiners.ranking;
        const counts = state => phaseResponseCounts({ state });
        const answerKeys = row => Object.keys(row).filter(key => /^r\d+$/.test(key)).sort();
        const assertAnswerKeys = (state, keys) =>
            state.forEach(row => assert.deepEqual(answerKeys(row), keys, row.userName));

        it("gives every semantic differential row one key per question", () => {
            const descriptor = {
                number:    1,
                questions: [{ id: 11, number: 1 }, { id: 12, number: 2 }, { id: 13, number: 3 }],
            };
            const responses = [
                { uid: 1, did: 11, sel: 2 },
                { uid: 1, did: 12, sel: 4 },
                { uid: 1, did: 13, sel: 5 },
                { uid: 2, did: 12, sel: 3 },
                { uid: 4, did: 11, sel: 1 },
            ];

            const state = sd.joinPhaseData(descriptor, responses, users, null);
            assertAnswerKeys(state, ["r1", "r2", "r3"]);
            assert.deepEqual(counts(state), { answered: 1, participants: 4 });

            const more = [{ uid: 2, did: 11, sel: 1 }, { uid: 2, did: 13, sel: 6 }];
            const refreshed = sd.joinPhaseData(
                descriptor, [...responses, ...more], users, null, state
            );
            assert.deepEqual(counts(refreshed), { answered: 2, participants: 4 });
        });

        it("gives every ranking row one key per position", () => {
            const descriptor = { number: 1, questions: [{ id: 21 }, { id: 22 }, { id: 23 }] };
            const responses = [
                { uid: 1, actorid: 21, orden: 1, description: "First" },
                { uid: 1, actorid: 22, orden: 2, description: "Second" },
                { uid: 1, actorid: 23, orden: 3, description: "Third" },
                { uid: 2, actorid: 22, orden: 1, description: "First" },
            ];

            const state = ranking.joinPhaseData(descriptor, responses, users, null);
            assertAnswerKeys(state, ["r1", "r2", "r3"]);
            assert.deepEqual(counts(state), { answered: 1, participants: 3 });

            const more = [
                { uid: 2, actorid: 21, orden: 2, description: "Second" },
                { uid: 2, actorid: 23, orden: 3, description: "Third" },
            ];
            const refreshed = ranking.joinPhaseData(
                descriptor, [...responses, ...more], users, null, state
            );
            assert.deepEqual(counts(refreshed), { answered: 2, participants: 3 });
        });

        it("leaves the groups' summary rows out of the count", () => {
            const questions = [{ id: 11, number: 1 }, { id: 12, number: 2 }];
            const descriptor = { number: 1, questions };
            const responses = [{ uid: 1, did: 11, sel: 2 }, { uid: 1, did: 12, sel: 4 }];
            const groups = [{ id: 7, number: 1, participants: [1, 2] }];

            const joined = sd.joinPhaseData(descriptor, responses, users.slice(0, 2), null);
            const state = sd.updateGroupStatistics(sd.addGroupInfo(joined, groups), () => "Group");

            assert.equal(state.filter(row => row.groupStatistics).length, 1);
            assert.deepEqual(counts(state), { answered: 1, participants: 2 });
        });
    });
});
