import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
});
