import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";

/**
 * Storage of the AI Additions connection and of the versioned AI service
 * policy (see database/migrations/V22__ai_service_policy.sql).
 *
 * - The connection is a single, unversioned row. No row means no connection,
 *   and then EthicApp makes no AI calls. It is read on every call, never
 *   cached, because the management console can change it at any time.
 * - Policy versions are append-only and immutable (a database trigger rejects
 *   updates and deletes), so a version read once is cached without expiry.
 * - Each session is pinned to a policy version. The activity launch
 *   transaction pins it to the version current at launch; ethicapp writes
 *   nothing else to these tables.
 *
 * Database access is injectable: `createAiServicePolicyStore({ getDb })` takes
 * a function that resolves to anything with `query(sql, params)` returning
 * `{ rows }` (a `pg` Pool or client). The named exports use the shared pool.
 */

/**
 * @typedef {Object} AiAdditionsConnection
 * @property {string} baseUrl                 http(s) URL of the AI Additions gateway.
 * @property {string|null} keycloakPublicUrl  Stored public Keycloak URL, or null when
 *                                            not set (consumers then default it to
 *                                            `baseUrl + "/keycloak"`).
 * @property {Date} updatedAt                 When the connection was last saved.
 * @property {number|null} updatedBy         User id of who saved it, if known.
 */

/**
 * @typedef {Object} AiServicePolicyVersion
 * A frozen object: callers must not (and cannot) mutate it.
 * @property {number} id                                Version id; the highest is current.
 * @property {ReadonlyArray<string>} allowedServiceIds  AI Additions service ids allowed.
 *                                                      Empty means no service is allowed.
 * @property {string|null} note                         Operator note.
 * @property {Date} createdAt                           When the version was saved.
 * @property {number|null} createdBy                    User id of its author; null for
 *                                                      the seed version 1.
 */

const VERSION_COLUMNS = "id, allowed_service_ids, note, created_at, created_by";

function toConnection(row) {
    if (!row) {
        return null;
    }

    return {
        baseUrl:           row.base_url,
        keycloakPublicUrl: row.keycloak_public_url ?? null,
        updatedAt:         row.updated_at,
        updatedBy:         row.updated_by ?? null,
    };
}

function toPolicyVersion(row) {
    if (!row) {
        return null;
    }

    return Object.freeze({
        id:                Number(row.id),
        allowedServiceIds: Object.freeze([...(row.allowed_service_ids ?? [])]),
        note:              row.note ?? null,
        createdAt:         row.created_at,
        createdBy:         row.created_by ?? null,
    });
}

function toVersionId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function defaultGetDb() {
    return rpg2.getDBInstance(config.dbconnString);
}

/**
 * Pins a session to the AI service policy version current at this moment, and
 * returns the version the session is pinned to.
 *
 * Run it inside the activity launch transaction, before the `activity` row is
 * inserted: the pin only moves while the session has no activity, so a session
 * that was already launched keeps its pin and later versions never change it.
 *
 * Concurrency: the session row is locked first (`FOR UPDATE`, held until the
 * transaction ends), and the activity check runs afterwards as a separate
 * statement. Under READ COMMITTED each statement takes a fresh snapshot, so a
 * concurrent launch that waited for the lock sees the activity the first
 * launch committed and keeps its pin. Checking and updating in one statement
 * would reuse a snapshot taken before the lock wait and re-pin the session.
 *
 * @param {{ query: Function }} client  A `pg` client inside an open transaction.
 * @param {number|string} sessionId
 * @returns {Promise<number|null>} The pinned version id, or null when the
 *          session does not exist.
 */
export async function pinSessionPolicy(client, sessionId) {
    const locked = await client.query(`
        SELECT ai_service_policy_version_id
        FROM sessions
        WHERE id = $1
        FOR UPDATE;
    `, [sessionId]);

    if (locked.rows.length === 0) {
        return null;
    }

    const pinned = await client.query(`
        UPDATE sessions
        SET ai_service_policy_version_id = current_ai_service_policy_version_id()
        WHERE id = $1
          AND NOT EXISTS (
              SELECT 1
              FROM activity
              WHERE activity.session = sessions.id
          )
        RETURNING ai_service_policy_version_id;
    `, [sessionId]);

    const row = pinned.rows[0] ?? locked.rows[0];
    return toVersionId(row.ai_service_policy_version_id);
}

/**
 * Builds the policy store over an injectable database. Each store has its own
 * immutable-version cache.
 *
 * @param {{ getDb?: () => Promise<{ query: Function }> }} [options]
 */
export function createAiServicePolicyStore({ getDb = defaultGetDb } = {}) {
    const versionCache = new Map();

    function remember(version) {
        if (version) {
            versionCache.set(version.id, version);
        }
        return version;
    }

    async function query(sql, params = []) {
        const db = await getDb();
        const result = await db.query(sql, params);
        return result.rows;
    }

    return {
        /**
         * Reads the AI Additions connection. Never cached.
         * @returns {Promise<AiAdditionsConnection|null>} null when no connection
         *          is configured.
         */
        async getConnection() {
            const rows = await query(`
                SELECT base_url, keycloak_public_url, updated_at, updated_by
                FROM ai_additions_connection
                WHERE id = 1;
            `);
            return toConnection(rows[0]);
        },

        /**
         * Reads the current policy version (the highest id). The lookup always
         * hits the database, because a newer version can be saved at any time;
         * the version it returns is cached like any other.
         * @returns {Promise<AiServicePolicyVersion|null>} null only if the table
         *          is empty, which the migration's seed rules out.
         */
        async getCurrentPolicyVersion() {
            const rows = await query(`
                SELECT ${VERSION_COLUMNS}
                FROM ai_service_policy_versions
                ORDER BY id DESC
                LIMIT 1;
            `);
            const version = toPolicyVersion(rows[0]);
            return versionCache.get(version?.id) ?? remember(version);
        },

        /**
         * Reads a policy version by id, cached without expiry because versions
         * are immutable. Unknown ids are not cached.
         * @param {number|string} id
         * @returns {Promise<AiServicePolicyVersion|null>} null for an unknown or
         *          invalid id.
         */
        async getPolicyVersion(id) {
            const versionId = toVersionId(id);
            if (versionId === null) {
                return null;
            }

            if (versionCache.has(versionId)) {
                return versionCache.get(versionId);
            }

            const rows = await query(`
                SELECT ${VERSION_COLUMNS}
                FROM ai_service_policy_versions
                WHERE id = $1;
            `, [versionId]);
            return remember(toPolicyVersion(rows[0]));
        },

        pinSessionPolicy,
    };
}

const defaultStore = createAiServicePolicyStore();

export const getConnection = defaultStore.getConnection;
export const getCurrentPolicyVersion = defaultStore.getCurrentPolicyVersion;
export const getPolicyVersion = defaultStore.getPolicyVersion;
