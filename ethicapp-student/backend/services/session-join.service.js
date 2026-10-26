export const JOIN_OUTCOMES = Object.freeze({
  JOINED: 'joined',
  ALREADY_JOINED: 'already_joined',
  CODE_NOT_FOUND: 'code_not_found',
  JOINING_CLOSED: 'joining_closed'
});

const SESSION_CODE_PATTERN = /^[a-z0-9]{1,16}$/;
const MAX_DEVICE_LENGTH = 64;

/**
 * @param {unknown} rawCode Code submitted by the student.
 * @returns {string | null} Trimmed lower-case code, or null when malformed.
 */
export function normalizeSessionCode(rawCode) {
  if (typeof rawCode !== 'string') {
    return null;
  }

  const code = rawCode.trim().toLowerCase();
  return SESSION_CODE_PATTERN.test(code) ? code : null;
}

/**
 * @param {unknown} rawDevice Optional device label submitted by the client.
 * @returns {{ valid: boolean, device: string | null }}
 */
export function normalizeDevice(rawDevice) {
  if (rawDevice === undefined || rawDevice === null) {
    return { valid: true, device: null };
  }

  if (typeof rawDevice !== 'string') {
    return { valid: false, device: null };
  }

  const device = rawDevice.trim();

  if (device.length > MAX_DEVICE_LENGTH) {
    return { valid: false, device: null };
  }

  return { valid: true, device: device || null };
}

async function findSessionForJoin(query, { uid, code }) {
  const result = await query(
    `
      SELECT s.id AS sesid,
             EXISTS (
                 SELECT 1
                 FROM sesusers AS su
                 WHERE su.sesid = s.id
                   AND su.uid = $1
             ) AS already_joined,
             EXISTS (
                 SELECT 1
                 FROM stages AS st
                 WHERE st.sesid = s.id
                   AND st.type = 'team'
             ) AS joining_closed
      FROM sessions AS s
      WHERE s.code = $2
      LIMIT 1
    `,
    [uid, code]
  );

  return result.rows[0] ?? null;
}

async function insertMembership(query, { uid, sessionId, device }) {
  const result = await query(
    `
      INSERT INTO sesusers (uid, sesid, device)
      VALUES ($1, $2, $3)
      ON CONFLICT ON CONSTRAINT no_dup_users DO NOTHING
      RETURNING sesid
    `,
    [uid, sessionId, device]
  );

  return result.rowCount > 0;
}

// The membership is already stored when this runs, so a notification failure
// must never turn the join into an error. The publisher bounds its own wait.
async function notifyParticipantJoined(publisher, logger, payload) {
  try {
    const published = await publisher.publish('session-participant-joined', 1, payload);

    if (!published) {
      logger.warn(`[join] Teacher notification not delivered for ${JSON.stringify(payload)}.`);
    }
  } catch (error) {
    logger.error('[join] Teacher notification failed:', error);
  }
}

/**
 * Joins a student to the session identified by `code`.
 *
 * A student who already participates gets `already_joined`, including when a
 * concurrent request inserted the membership first. Joining is closed once
 * the session has a team stage, matching the legacy rule.
 *
 * @param {object} params
 * @param {number} params.uid Authenticated student id.
 * @param {string} params.code Normalized session code.
 * @param {string | null} params.device Normalized device label.
 * @param {(text: string, params: unknown[]) => Promise<{ rows: object[], rowCount: number }>} params.query
 * @param {{ publish: Function }} params.publisher Domain-event publisher.
 * @param {Console} [params.logger]
 * @returns {Promise<{ outcome: string, sessionId: number | null }>}
 */
export async function joinSessionByCode({ uid, code, device, query, publisher, logger = console }) {
  const session = await findSessionForJoin(query, { uid, code });
  let result;

  if (!session) {
    result = { outcome: JOIN_OUTCOMES.CODE_NOT_FOUND, sessionId: null };
  } else if (session.already_joined) {
    result = { outcome: JOIN_OUTCOMES.ALREADY_JOINED, sessionId: session.sesid };
  } else if (session.joining_closed) {
    result = { outcome: JOIN_OUTCOMES.JOINING_CLOSED, sessionId: session.sesid };
  } else if (await insertMembership(query, { uid, sessionId: session.sesid, device })) {
    result = { outcome: JOIN_OUTCOMES.JOINED, sessionId: session.sesid };
    await notifyParticipantJoined(publisher, logger, { sessionId: session.sesid, userId: uid, device });
  } else {
    result = { outcome: JOIN_OUTCOMES.ALREADY_JOINED, sessionId: session.sesid };
  }

  logger.info(`[join] ${JSON.stringify({ ...result, uid, code })}`);
  return result;
}
