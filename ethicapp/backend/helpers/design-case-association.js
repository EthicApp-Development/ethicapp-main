/**
 * Which case a teacher may associate with a design (#924, epic #923).
 *
 * The case read rules trust `designs.case_id`: whoever creates a design that
 * points at a case may read that case, its PDF and its rendered pages
 * (`getReadableCaseWithDocumentProcessing` in controllers/cases.js,
 * controllers/protected-uploads.js). So a design may only point at a case its
 * creator could pick in the editor's case search (`GET /cases/search`):
 * - the case exists and is not archived;
 * - it is the teacher's own, or it is public.
 *
 * A missing case, an archived one and another teacher's private case get the
 * same answer, 404 `CASE_NOT_AVAILABLE`, so the answer does not reveal that a
 * private case exists. Each refusal is logged as a security event, with ids
 * only.
 */
import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import { summarizeSecurityRefusal } from "./log-safety.js";

export const CASE_NOT_AVAILABLE_CODE = "CASE_NOT_AVAILABLE";
export const DESIGN_CASE_REFUSED_EVENT = "design_case_association_refused";

/**
 * The SQL condition under which the case aliased `caseAlias` may be picked by
 * the user whose id is the parameter `userParam`. `GET /cases/search` lists
 * the cases that meet it, and a design may only be pointed at one of them.
 * @param {string} caseAlias - The alias of `ethical_cases` in the query.
 * @param {string} userParam - The placeholder of the user id, such as `$2`.
 * @returns {string}
 */
export function associableCaseSql(caseAlias, userParam) {
    return `((${caseAlias}.creator = ${userParam} OR ${caseAlias}.visibility = 'public')`
        + ` AND COALESCE(${caseAlias}.archived, false) = false)`;
}

// $1 case id, $2 user id. One row when the user may associate the case.
export const ASSOCIABLE_CASE_SQL = `
    SELECT c.id
    FROM ethical_cases AS c
    WHERE c.id = $1
      AND ${associableCaseSql("c", "$2")}
`;

async function findAssociableCase(caseId, userId) {
    const row = await rpg2.singleSQL({
        dbcon:     config.dbconnString,
        sql:       ASSOCIABLE_CASE_SQL,
        sqlParams: [
            rpg2.param("plain", caseId),
            rpg2.param("plain", userId),
        ],
    });
    // rest-pg-2's singleSQL returns {} when no row matches.
    return Boolean(row?.id);
}

function isNoCase(value) {
    return value === undefined || value === null || value === "";
}

// A positive integer, or a string of digits that is one; null otherwise.
function parseCaseId(value) {
    const id = typeof value === "string" && /^[0-9]{1,15}$/u.test(value) ? Number(value) : value;
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function caseNotAvailableRefusal() {
    return {
        status: 404,
        body:   {
            status:  "err",
            code:    CASE_NOT_AVAILABLE_CODE,
            message: "The selected case is not available. Choose another case or save without one.",
        },
    };
}

/**
 * Checks the case that `POST /designs` or `PATCH /designs/:id` would store.
 *
 * - No case (`null`, `undefined` or `""`) is always accepted.
 * - On an update, the case the design already points at (`storedCaseId`) is
 *   kept without a check: the design already grants its creator read access
 *   to that case, so keeping it grants nothing new, and a case picked while
 *   it was public stays usable after its author makes it private or archives
 *   it.
 * - Any other case must exist, not be archived, and be the user's own or
 *   public. Otherwise the refusal is logged once, and nothing may be written.
 *
 * @param {Object} request
 * @param {unknown} request.requestedCaseId - `caseId` from the request body.
 * @param {number|null} [request.storedCaseId] - The design's current case.
 * @param {number} request.userId - The session user.
 * @param {number|null} [request.designId] - The design being updated.
 * @param {Object} [dependencies]
 * @param {(caseId: number, userId: number) => Promise<boolean>}
 *     [dependencies.isAssociable] - Tests replace the database lookup.
 * @param {(message: string, entry: Object) => void} [dependencies.warn]
 * @returns {Promise<{caseId: number|null}|{refusal: {status: number,
 *     body: Object}}>} The case id to store, or the refusal to send.
 */
export async function checkDesignCase({
    requestedCaseId,
    storedCaseId = null,
    userId,
    designId = null,
}, {
    isAssociable = findAssociableCase,
    warn = console.warn,
} = {}) {
    if (isNoCase(requestedCaseId)) {
        return { caseId: null };
    }

    const caseId = parseCaseId(requestedCaseId);
    if (caseId !== null && storedCaseId !== null && caseId === Number(storedCaseId)) {
        return { caseId };
    }

    if (caseId === null || !(await isAssociable(caseId, userId))) {
        warn("[security] Refused the case of a design.", summarizeSecurityRefusal(
            DESIGN_CASE_REFUSED_EVENT,
            { userId, designId, caseId: requestedCaseId }
        ));
        return { refusal: caseNotAvailableRefusal() };
    }

    return { caseId };
}
