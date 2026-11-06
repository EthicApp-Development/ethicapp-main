import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";

/**
 * The activity's locale (#1133, epic #1124): the language an activity's
 * results for students are written in, from its design's
 * `designs.language_code`. External services receive it as `context.locale`
 * in phase hooks and in `student-results-reading`.
 */

// The locale of an activity whose design has no language, the column default
// of `designs.language_code`.
export const DEFAULT_ACTIVITY_LOCALE = "es_CL";

/**
 * The activity's locale, `es_CL` or `en_US`, from its design's
 * `designs.language_code` by the canonical rule: Spanish (`es`, `es_*`,
 * `es-*`) is `es_CL`, anything else `en_US`, and no language is `es_CL`.
 * @param {unknown} languageCode
 * @returns {"es_CL"|"en_US"}
 */
export function activityLocale(languageCode) {
    const code = typeof languageCode === "string" ? languageCode.trim() : "";
    if (!code) {
        return DEFAULT_ACTIVITY_LOCALE;
    }
    return /^es(?:[-_]|$)/iu.test(code) ? "es_CL" : "en_US";
}

export const SESSION_ACTIVITY_LANGUAGE_SQL = `
    SELECT ds.language_code
    FROM activity AS a
    INNER JOIN designs AS ds
        ON ds.id = a.design
    WHERE a.session = $1
    LIMIT 1
`;

/**
 * The locale of a session's activity (activityLocale()), or null when the
 * session has no activity design.
 * @param {number} sessionId
 * @returns {Promise<"es_CL"|"en_US"|null>}
 */
export async function loadSessionActivityLocale(sessionId) {
    const row = await rpg2.singleSQL({
        dbcon:     config.dbconnString,
        sql:       SESSION_ACTIVITY_LANGUAGE_SQL,
        sqlParams: [rpg2.param("plain", Number(sessionId))],
    });
    return row ? activityLocale(row.language_code) : null;
}
