import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import { pinSessionPolicy as defaultPinSessionPolicy } from "./ai-service-policy.js";

async function defaultConnect() {
    const db = await rpg2.getDBInstance(config.dbconnString);
    return db.connect();
}

/**
 * Launches an activity in one transaction: pins the session to the current AI
 * service policy version, assigns the session code (only if it has none yet),
 * creates the `activity` row and locks the design. Any failure rolls back all
 * of it.
 *
 * The pin runs first because it only moves while the session has no activity.
 *
 * @param {{ sessionId: number|string, designId: number|string, sessionCode: string }} launch
 * @param {Object} [dependencies]
 * @param {() => Promise<{ query: Function, release: Function }>} [dependencies.connect]
 *        Checks out a `pg` client.
 * @param {(client: Object, sessionId: number|string) => Promise<number|null>}
 *        [dependencies.pinSessionPolicy]
 * @returns {Promise<{ policyVersionId: number|null }>} The version the session is
 *          pinned to.
 */
export async function launchActivity(
    { sessionId, designId, sessionCode },
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
