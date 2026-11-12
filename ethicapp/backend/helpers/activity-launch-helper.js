import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import { pinSessionPolicy as defaultPinSessionPolicy } from "./ai-service-policy.js";
import { TIME_MODES, launchTimeMode } from "./session-time-mode.js";

async function defaultConnect() {
    const db = await rpg2.getDBInstance(config.dbconnString);
    return db.connect();
}

/**
 * Launches an activity in one transaction: pins the session to the current AI
 * service policy version, assigns the session code (only if it has none yet),
 * stores the AI services switch (#970) and the time mode (#1109), creates the
 * `activity` row and locks the design. Any failure rolls back all of it.
 *
 * The pin runs first because it only moves while the session has no activity.
 * The switch and the time mode follow the same rule: a relaunch keeps the
 * stored ones.
 *
 * @param {{ sessionId: number|string, designId: number|string, sessionCode: string,
 *          aiServicesEnabled?: boolean, timeMode?: string }} launch
 *        `aiServicesEnabled` false launches the activity with the design's AI
 *        services turned off; it defaults to true. `timeMode` is "soft",
 *        "hard" or "none" (the default); a design without any phase duration
 *        is stored with "none" whatever is asked.
 * @param {Object} [dependencies]
 * @param {() => Promise<{ query: Function, release: Function }>} [dependencies.connect]
 *        Checks out a `pg` client.
 * @param {(client: Object, sessionId: number|string) => Promise<number|null>}
 *        [dependencies.pinSessionPolicy]
 * @returns {Promise<{ policyVersionId: number|null }>} The version the session is
 *          pinned to.
 */
export async function launchActivity(
    { sessionId, designId, sessionCode, aiServicesEnabled = true, timeMode = TIME_MODES.NONE },
    { connect = defaultConnect, pinSessionPolicy = defaultPinSessionPolicy } = {}
) {
    const client = await connect();

    try {
        await client.query("BEGIN");

        const policyVersionId = await pinSessionPolicy(client, sessionId);

        await client.query(`
            UPDATE sessions
            SET code = $1
            WHERE id = $2
              AND code IS NULL;
        `, [sessionCode, sessionId]);

        await client.query(`
            UPDATE sessions
            SET ai_services_enabled = $1
            WHERE id = $2
              AND NOT EXISTS (
                  SELECT 1
                  FROM activity
                  WHERE activity.session = sessions.id
              );
        `, [aiServicesEnabled !== false, sessionId]);

        const { rows: designRows = [] } = await client.query(`
            SELECT design
            FROM designs
            WHERE id = $1;
        `, [designId]);

        await client.query(`
            UPDATE sessions
            SET time_mode = $1
            WHERE id = $2
              AND NOT EXISTS (
                  SELECT 1
                  FROM activity
                  WHERE activity.session = sessions.id
              );
        `, [launchTimeMode(timeMode, designRows[0]?.design), sessionId]);

        await client.query(`
            INSERT INTO activity (design, session)
            VALUES ($1, $2);
        `, [designId, sessionId]);

        await client.query(`
            UPDATE designs
            SET locked = TRUE
            WHERE id = $1;
        `, [designId]);

        await client.query("COMMIT");
        return { policyVersionId };
    } catch (error) {
        await client.query("ROLLBACK").catch((rollbackError) => {
            console.error("Error rolling back activity launch:", rollbackError);
        });
        throw error;
    } finally {
        client.release();
    }
}
