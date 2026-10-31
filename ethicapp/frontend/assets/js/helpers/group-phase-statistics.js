// The group-phase table's per-group figures (#919): the group chat count of
// a ranking, and the averages and coefficients of variation of a semantic
// differential. A student without a group in the phase belongs to no group:
// they get no group figures and no summary row.

function hasGroup(row) {
    return row?.groupNumber !== null && row?.groupNumber !== undefined && row?.groupNumber !== "";
}

/**
 * The students' rows of each group, by group number. Summary rows and
 * groupless students are left out.
 */
export function membersByGroup(rows) {
    const groups = new Map();
    (rows || []).forEach(row => {
        if (row?.groupStatistics || !hasGroup(row)) {
            return;
        }
        const groupNumber = Number(row.groupNumber);
        if (!groups.has(groupNumber)) {
            groups.set(groupNumber, []);
        }
        groups.get(groupNumber).push(row);
    });
    return groups;
}

/**
 * Ranking: each member shows the chat messages of their whole group, as
 * `groupChatMessages`. A groupless student has none.
 */
export function addRankingGroupChatCounts(rows) {
    membersByGroup(rows).forEach(members => {
        const total = members.reduce((sum, member) => sum + (member.totalChatCount || 0), 0);
        members.forEach(member => {
            member.groupChatMessages = total;
        });
    });
    (rows || []).filter(row => !row?.groupStatistics && !hasGroup(row)).forEach(row => {
        delete row.groupChatMessages;
    });
    return rows;
}

function questionStatistics(members, questions) {
    const stats = {};
    questions.forEach((question, index) => {
        const values = members.map(member => member[`r${index + 1}`])
            .filter(value => value !== null && value !== undefined);

        if (values.length === 0) {
            stats[`averageR${index + 1}`] = "-";
            stats[`cvR${index + 1}`] = "-";
            return;
        }

        const average = values.reduce((sum, value) => sum + value, 0) / values.length;
        const variance = values.reduce((sum, value) => sum + Math.pow(value - average, 2), 0)
            / values.length;
        const cv = average !== 0 ? Math.sqrt(variance) / average : 0;
        stats[`averageR${index + 1}`] = average.toFixed(2);
        stats[`cvR${index + 1}`] = cv.toFixed(2);
    });
    return stats;
}

/**
 * Semantic differential: each group's summary row gets the average and the
 * coefficient of variation of every question. A group without a summary row
 * gets one at the end.
 */
export function addDifferentialGroupStatistics(rows, questions) {
    membersByGroup(rows).forEach((members, groupNumber) => {
        let summary = rows.find(row => {
            return row.groupStatistics && Number(row.groupNumber) === groupNumber;
        });
        if (!summary) {
            summary = { groupStatistics: true, groupNumber, stats: {} };
            rows.push(summary);
        }
        Object.assign(summary, questionStatistics(members, questions || []));
    });
    return rows;
}
