// How much a case is used (#1011, epic #1008): the activities launched from
// the designs that use it, and those designs, split into the teacher's own and
// other teachers'. `GET /cases` returns it for the teacher's own and archived
// cases, and the case's uses (`GET /cases/:id/uses`) reuse the same SQL.
//
// Other teachers' use of a case is reported only to its author, so the public
// scope of `GET /cases` does not select it.
//
// - Archived designs count: they keep their case.
// - `activityCount` counts the activities launched from any design that uses
//   the case, whoever created the design or launched the activity.
// - `otherTeacherCount` counts the distinct creators of the other designs. A
//   design without a creator counts as another teacher's design but adds no
//   teacher.

/**
 * A SQL expression, for a select list, whose value is the usage of the case
 * aliased `caseAlias` as a JSON object with the keys `activityCount`,
 * `ownDesignCount`, `otherDesignCount` and `otherTeacherCount`. Designs whose
 * creator is the parameter `userParam` are the teacher's own.
 *
 * One aggregate over the case's designs (`idx_designs_case_id`) and their
 * activities (`idx_activity_design`); it always yields one row, with zeros
 * when no design uses the case.
 *
 * @param {string} caseAlias - The alias of `ethical_cases` in the query.
 * @param {string} userParam - The placeholder of the teacher's id, such as `$1`.
 * @returns {string}
 */
export function caseUsageJsonSql(caseAlias, userParam) {
    return `(
        SELECT json_build_object(
            'activityCount', COUNT(usage_activity.id),
            'ownDesignCount', COUNT(DISTINCT usage_design.id)
                FILTER (WHERE usage_design.creator = ${userParam}),
            'otherDesignCount', COUNT(DISTINCT usage_design.id)
                FILTER (WHERE usage_design.creator IS DISTINCT FROM ${userParam}),
            'otherTeacherCount', COUNT(DISTINCT usage_design.creator)
                FILTER (WHERE usage_design.creator IS DISTINCT FROM ${userParam})
        )
        FROM designs usage_design
        LEFT JOIN activity usage_activity ON usage_activity.design = usage_design.id
        WHERE usage_design.case_id = ${caseAlias}.id
    )`;
}

function countOf(value) {
    const count = Number(value);
    return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

/**
 * The usage of a case as the API returns it, from the value of
 * `caseUsageJsonSql`. Missing or invalid counts are 0.
 * @param {object|null|undefined} value
 * @returns {{
 *   activityCount: number,
 *   ownDesignCount: number,
 *   otherDesignCount: number,
 *   otherTeacherCount: number,
 * }}
 */
export function normalizeCaseUsage(value) {
    return {
        activityCount:     countOf(value?.activityCount),
        ownDesignCount:    countOf(value?.ownDesignCount),
        otherDesignCount:  countOf(value?.otherDesignCount),
        otherTeacherCount: countOf(value?.otherTeacherCount),
    };
}
