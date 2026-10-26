import { query as defaultQuery } from '../config/database.js';

// Data access for the AI Additions connection and the append-only AI service
// policy (database/migrations/V22__ai_service_policy.sql). The console is the
// only writer of both tables; ethicapp only pins sessions to a version.

const MAX_URL_LENGTH = 2048;
const MAX_NOTE_LENGTH = 1000;
const MAX_ALLOWED_SERVICES = 100;
const SERVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export class AiServicesValidationError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'AiServicesValidationError';
    this.code = code;
    this.details = details;
  }
}

// Returns the URL as entered (trimmed) when it is an absolute http(s) URL with
// a host, no userinfo and no fragment; otherwise null. The value is stored as
// typed so operators see what they saved.
export function normalizeConnectionUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed || trimmed.length > MAX_URL_LENGTH || /\s/.test(trimmed) || trimmed.includes('#')) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return null;
  }

  // The WHATWG parser drops an empty userinfo ("http://@host"), so the raw
  // authority is checked as well.
  const rawAuthority = /^https?:\/\/([^/?]*)/i.exec(trimmed)?.[1] || '';

  if (!parsed.hostname || parsed.username || parsed.password || rawAuthority.includes('@')) {
    return null;
  }

  return trimmed;
}

// Validates { baseUrl, keycloakPublicUrl? } from a request body.
export function parseConnectionInput(body = {}) {
  const baseUrl = normalizeConnectionUrl(body.baseUrl);

  if (!baseUrl) {
    throw new AiServicesValidationError('INVALID_BASE_URL');
  }

  const rawKeycloakUrl = body.keycloakPublicUrl;
  const keycloakIsBlank = rawKeycloakUrl === undefined
    || rawKeycloakUrl === null
    || (typeof rawKeycloakUrl === 'string' && rawKeycloakUrl.trim() === '');

  if (keycloakIsBlank) {
    return { baseUrl, keycloakPublicUrl: null };
  }

  const keycloakPublicUrl = normalizeConnectionUrl(rawKeycloakUrl);

  if (!keycloakPublicUrl) {
    throw new AiServicesValidationError('INVALID_KEYCLOAK_PUBLIC_URL');
  }

  return { baseUrl, keycloakPublicUrl };
}

// Validates { allowedServiceIds, note } from a request body. Ids are trimmed
// and deduplicated, keeping the first-seen order.
export function parsePolicyInput(body = {}) {
  const { allowedServiceIds, note } = body;

  if (!Array.isArray(allowedServiceIds) || allowedServiceIds.length > MAX_ALLOWED_SERVICES) {
    throw new AiServicesValidationError('INVALID_ALLOWED_SERVICE_IDS');
  }

  const ids = [];
  for (const rawId of allowedServiceIds) {
    const id = typeof rawId === 'string' ? rawId.trim() : '';

    if (!SERVICE_ID_PATTERN.test(id)) {
      throw new AiServicesValidationError('INVALID_ALLOWED_SERVICE_IDS');
    }

    if (!ids.includes(id)) {
      ids.push(id);
    }
  }

  if (note !== undefined && note !== null && typeof note !== 'string') {
    throw new AiServicesValidationError('INVALID_NOTE');
  }

  const trimmedNote = typeof note === 'string' ? note.trim() : '';

  if (trimmedNote.length > MAX_NOTE_LENGTH) {
    throw new AiServicesValidationError('INVALID_NOTE');
  }

  return { allowedServiceIds: ids, note: trimmedNote || null };
}

function toUserSummary(row, prefix) {
  const id = row[`${prefix}_id`];

  if (id === null || id === undefined) {
    return null;
  }

  const name = [row[`${prefix}_firstname`], row[`${prefix}_lastname`]]
    .filter((part) => part && String(part).trim())
    .join(' ')
    .trim();

  return { id: Number(id), name: name || row[`${prefix}_mail`] || null };
}

function toConnection(row) {
  if (!row) {
    return null;
  }

  return {
    baseUrl: row.base_url,
    keycloakPublicUrl: row.keycloak_public_url,
    updatedAt: row.updated_at,
    updatedBy: toUserSummary(row, 'updated_by')
  };
}

function toPolicyVersion(row) {
  return {
    id: Number(row.id),
    allowedServiceIds: row.allowed_service_ids || [],
    note: row.note,
    createdAt: row.created_at,
    createdBy: toUserSummary(row, 'created_by'),
    launchedSessionCount: Number(row.launched_session_count || 0)
  };
}

const CONNECTION_SELECT_SQL = `
  SELECT
    c.base_url,
    c.keycloak_public_url,
    c.updated_at,
    u.id AS updated_by_id,
    u.firstname AS updated_by_firstname,
    u.lastname AS updated_by_lastname,
    u.mail AS updated_by_mail
  FROM ai_additions_connection c
  LEFT JOIN users u ON u.id = c.updated_by
  WHERE c.id = 1
`;

// A session counts as pinned to a version only once its activity has been
// launched: every session row gets the current version as a column default,
// but only the launch transaction pins it meaningfully.
export const POLICY_HISTORY_SQL = `
  SELECT
    v.id,
    v.allowed_service_ids,
    v.note,
    v.created_at,
    u.id AS created_by_id,
    u.firstname AS created_by_firstname,
    u.lastname AS created_by_lastname,
    u.mail AS created_by_mail,
    (
      SELECT count(*)
      FROM sessions s
      WHERE s.ai_service_policy_version_id = v.id
        AND EXISTS (SELECT 1 FROM activity a WHERE a.session = s.id)
    )::int AS launched_session_count
  FROM ai_service_policy_versions v
  LEFT JOIN users u ON u.id = v.created_by
  ORDER BY v.id DESC
`;

export function createAiServicesStore({ query = defaultQuery } = {}) {
  async function getConnection() {
    const result = await query(CONNECTION_SELECT_SQL, []);
    return toConnection(result.rows[0]);
  }

  async function saveConnection({ baseUrl, keycloakPublicUrl, userId }) {
    await query(
      `
        INSERT INTO ai_additions_connection (id, base_url, keycloak_public_url, updated_at, updated_by)
        VALUES (1, $1, $2, now(), $3)
        ON CONFLICT (id) DO UPDATE
        SET base_url = EXCLUDED.base_url,
            keycloak_public_url = EXCLUDED.keycloak_public_url,
            updated_at = EXCLUDED.updated_at,
            updated_by = EXCLUDED.updated_by
      `,
      [baseUrl, keycloakPublicUrl, userId]
    );

    return getConnection();
  }

  async function deleteConnection() {
    const result = await query('DELETE FROM ai_additions_connection WHERE id = 1', []);
    return result.rowCount > 0;
  }

  async function getPolicyHistory() {
    const result = await query(POLICY_HISTORY_SQL, []);
    const versions = result.rows.map(toPolicyVersion);
    return { current: versions[0] || null, versions };
  }

  // Versions are append-only: this only ever inserts a new row.
  async function createPolicyVersion({ allowedServiceIds, note, userId }) {
    const result = await query(
      `
        INSERT INTO ai_service_policy_versions (allowed_service_ids, note, created_by)
        VALUES ($1::text[], $2, $3)
        RETURNING id
      `,
      [allowedServiceIds, note, userId]
    );
    const versionId = Number(result.rows[0].id);
    const history = await getPolicyHistory();
    return history.versions.find((version) => version.id === versionId) || null;
  }

  return {
    getConnection,
    saveConnection,
    deleteConnection,
    getPolicyHistory,
    createPolicyVersion
  };
}

export default createAiServicesStore();
