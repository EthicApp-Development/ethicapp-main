import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";

// Room access rules mirror the HTTP rules in controllers/group-messages.js:
// teachers reach sessions they created; students reach sessions and groups
// they participate in.

async function queryAllowed(sql, params) {
    const rows = await rpg2.execSQL({
        dbcon:     config.dbconnString,
        sql,
        sqlParams: params.map(value => rpg2.param("plain", value)),
    });

    return rows[0]?.allowed === true;
}

/**
 * @param {(sql: string, params: number[]) => Promise<boolean>} [queryAllowedImpl]
 */
export function createRoomAccess(queryAllowedImpl = queryAllowed) {
    return {
        isSessionParticipant: (uid, sessionId) => queryAllowedImpl(
            `SELECT EXISTS (
                 SELECT 1 FROM sesusers WHERE uid = $1 AND sesid = $2
             ) AS allowed`,
            [uid, sessionId],
        ),

        isGroupMember: (uid, groupId) => queryAllowedImpl(
            `SELECT EXISTS (
                 SELECT 1 FROM teamusers WHERE uid = $1 AND tmid = $2
             ) AS allowed`,
            [uid, groupId],
        ),

        ownsSession: (uid, sessionId) => queryAllowedImpl(
            `SELECT EXISTS (
                 SELECT 1 FROM sessions WHERE creator = $1 AND id = $2
             ) AS allowed`,
            [uid, sessionId],
        ),

        ownsGroupSession: (uid, groupId) => queryAllowedImpl(
            `SELECT EXISTS (
                 SELECT 1
                 FROM teams AS t
                 INNER JOIN sessions AS s ON s.id = t.sesid
                 WHERE s.creator = $1 AND t.id = $2
             ) AS allowed`,
            [uid, groupId],
        ),
    };
}

export const roomAccess = createRoomAccess();
