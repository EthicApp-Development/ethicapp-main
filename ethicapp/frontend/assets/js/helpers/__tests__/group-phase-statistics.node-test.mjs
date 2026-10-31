import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    addDifferentialGroupStatistics,
    addRankingGroupChatCounts,
    membersByGroup,
} from "../group-phase-statistics.js";

const QUESTIONS = [{ id: 1 }, { id: 2 }];

describe("membersByGroup (#919)", () => {
    it("leaves out summary rows and students without a group", () => {
        const rows = [
            { userId: 1, groupNumber: 1 },
            { userId: 2, groupNumber: "1" },
            { userId: 3, groupNumber: 2 },
            { groupStatistics: true, groupNumber: 1 },
            { userId: 4, groupNumber: null },
            { userId: 5 },
            { userId: 6, groupNumber: "" },
        ];

        const groups = membersByGroup(rows);

        assert.deepEqual([...groups.keys()], [1, 2]);
        assert.deepEqual(groups.get(1).map(row => row.userId), [1, 2]);
        assert.deepEqual(groups.get(2).map(row => row.userId), [3]);
    });
});

describe("addRankingGroupChatCounts (#919)", () => {
    it("gives each member their group's messages and a groupless student none", () => {
        const rows = [
            { userId: 1, groupNumber: 1, totalChatCount: 2 },
            { userId: 2, groupNumber: 1, totalChatCount: 3 },
            { userId: 3, groupNumber: 2, totalChatCount: 1 },
            { userId: 4, groupNumber: null, totalChatCount: 4, groupChatMessages: 9 },
            { userId: 5, groupNumber: null, totalChatCount: 6 },
        ];

        addRankingGroupChatCounts(rows);

        assert.deepEqual(rows.map(row => row.groupChatMessages), [5, 5, 1, undefined, undefined]);
        assert.equal("groupChatMessages" in rows[3], false);
    });
});

describe("addDifferentialGroupStatistics (#919)", () => {
    const groupRows = () => [
        { userId: 1, groupNumber: 1, r1: 2, r2: 4 },
        { userId: 2, groupNumber: 1, r1: 4, r2: null },
        { groupStatistics: true, groupNumber: 1, groupName: "Group 1" },
        { userId: 3, groupNumber: 2, r1: 5, r2: 5 },
        { groupStatistics: true, groupNumber: 2, groupName: "Group 2" },
    ];

    it("fills each group's summary row", () => {
        const rows = addDifferentialGroupStatistics(groupRows(), QUESTIONS);

        assert.equal(rows.length, 5);
        const { averageR1, cvR1, averageR2, cvR2 } = rows[2];
        assert.deepEqual(
            { averageR1, cvR1, averageR2, cvR2 },
            { averageR1: "3.00", cvR1: "0.33", averageR2: "4.00", cvR2: "0.00" },
        );
        assert.equal(rows[4].averageR1, "5.00");
    });

    it("builds no group out of students without a group", () => {
        const rows = [
            ...groupRows(),
            { userId: 4, groupNumber: null, r1: 1, r2: 1 },
            { userId: 5, groupNumber: null, r1: 7, r2: 7 },
        ];

        addDifferentialGroupStatistics(rows, QUESTIONS);

        assert.equal(rows.length, 7);
        assert.equal(rows.filter(row => row.groupStatistics).length, 2);
        assert.equal(rows[2].averageR1, "3.00");
        assert.equal(rows[5].averageR1, undefined);
        assert.equal(rows.some(row => row.groupNumber === "Ungrouped"), false);
    });

    it("adds no row when it runs again on the same data", () => {
        const rows = [...groupRows(), { userId: 4, groupNumber: null, r1: 1, r2: 1 }];

        addDifferentialGroupStatistics(rows, QUESTIONS);
        addDifferentialGroupStatistics(rows, QUESTIONS);

        assert.equal(rows.length, 6);
    });

    it("adds a summary row for a group that has none", () => {
        const rows = [{ userId: 1, groupNumber: 3, r1: 6, r2: null }];

        addDifferentialGroupStatistics(rows, QUESTIONS);

        assert.equal(rows.length, 2);
        const { groupStatistics, groupNumber, averageR1, averageR2 } = rows[1];
        assert.deepEqual(
            { groupStatistics, groupNumber, averageR1, averageR2 },
            { groupStatistics: true, groupNumber: 3, averageR1: "6.00", averageR2: "-" },
        );
    });
});
