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
//   `ownActivityCount` counts only those of the teacher's own designs; the
//   case's uses give it to a teacher who is not the case's author (#1012).
// - `otherTeacherCount` counts the distinct creators of the other designs. A
//   design without a creator counts as another teacher's design but adds no
//   teacher.

/**
 * A SQL expression, for a select list, whose value is the usage of the case
 * aliased `caseAlias` as a JSON object with the keys `activityCount`,
 * `ownActivityCount`, `ownDesignCount`, `otherDesignCount` and
 * `otherTeacherCount`. Designs whose creator is the parameter `userParam` are
 * the teacher's own.
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
            'ownActivityCount', COUNT(usage_activity.id)
                FILTER (WHERE usage_design.creator = ${userParam}),
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
 * The usage of a case as `GET /cases` returns it, from the value of
 * `caseUsageJsonSql`. Missing or invalid counts are 0. `ownActivityCount` is
 * left out: only the case's uses return it.
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

/**
 * A SQL expression, for a select list, whose value is the JSON array of the
 * designs of the teacher `userParam` that use the case aliased `caseAlias`,
 * archived ones included, as `{ id, title, archived }`: the designs not
 * archived first, then the archived ones, each newest first (designs have no
 * update time). A design without a title has a
 * null `title`, which the page shows translated. Other teachers' designs are
 * never listed (#923): the case's uses give only their counts.
 *
 * @param {string} caseAlias - The alias of `ethical_cases` in the query.
 * @param {string} userParam - The placeholder of the teacher's id, such as `$1`.
 * @returns {string}
 */
export function caseOwnDesignsJsonSql(caseAlias, userParam) {
    return `COALESCE((
        SELECT json_agg(json_build_object(
            'id', own_design.id,
            'title', NULLIF(COALESCE(
                own_design.design #>> '{metainfo,title}',
                own_design.design ->> 'title'
            ), ''),
            'archived', COALESCE(own_design.archived, false)
        ) ORDER BY COALESCE(own_design.archived, false), own_design.id DESC)
        FROM designs own_design
        WHERE own_design.case_id = ${caseAlias}.id
          AND own_design.creator = ${userParam}
    ), '[]'::json)`;
}

function normalizeOwnDesigns(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter(design => Number.isSafeInteger(Number(design?.id)) && Number(design.id) > 0)
        .map(design => ({
            id:       Number(design.id),
            title:    typeof design.title === "string" && design.title !== "" ? design.title : null,
            archived: design.archived === true,
        }));
}

/**
 * The uses of a case as `GET /cases/:id/uses` returns them to a teacher who
 * can read the case (#1012), from the values of `caseOwnDesignsJsonSql` and
 * `caseUsageJsonSql` selected for that teacher.
 *
 * - `ownDesigns` lists the teacher's own designs that use the case.
 * - The case's author gets `activityCount` over every design that uses it,
 *   the counts of other teachers' designs and of those teachers, and
 *   `designsKeepingAccess`, the designs of other teachers that keep reading
 *   the case whatever its visibility (#939), which also keep it from being
 *   deleted (`CASE_USED_BY_OTHER_TEACHERS`). It differs from
 *   `otherDesignCount` only by the designs without a creator.
 * - Any other teacher gets `activityCount` over their own designs only, and
 *   nothing about other teachers' designs (#923).
 *
 * @param {{
 *   ownDesigns: unknown,
 *   usage: object|null|undefined,
 *   isAuthor: boolean,
 *   designsKeepingAccess?: number,
 * }} uses
 * @returns {{
 *   ownDesigns: Array<{id: number, title: string|null, archived: boolean}>,
 *   activityCount: number,
 *   otherDesignCount?: number,
 *   otherTeacherCount?: number,
 *   designsKeepingAccess?: number,
 * }}
 */
export function normalizeCaseUses({ ownDesigns, usage, isAuthor, designsKeepingAccess }) {
    const designs = normalizeOwnDesigns(ownDesigns);
    if (!isAuthor) {
        return {
            ownDesigns:    designs,
            activityCount: countOf(usage?.ownActivityCount),
        };
    }

    const counts = normalizeCaseUsage(usage);
    return {
        ownDesigns:           designs,
        activityCount:        counts.activityCount,
        otherDesignCount:     counts.otherDesignCount,
        otherTeacherCount:    counts.otherTeacherCount,
        designsKeepingAccess: countOf(designsKeepingAccess),
    };
}
