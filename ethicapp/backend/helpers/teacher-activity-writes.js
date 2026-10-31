/**
 * The statements with which a teacher opens or advances an activity: creating
 * its session and moving it to a phase. Each one locks the requesting
 * teacher's account row (FOR SHARE) and writes only while the account is not
 * anonymized.
 *
 * Forgetting a teacher (#877) holds that row FOR UPDATE from before its last
 * count of the teacher's open activities until it commits. A request already
 * authorized when forgetting started therefore waits for it, and once
 * forgetting commits, PostgreSQL re-reads the row, finds the account
 * anonymized and writes nothing. Without the lock, a phase transition, which
 * changes no foreign key to users, could reopen an activity after that count,
 * and a new session would be created under the anonymized account as soon as
 * its foreign key check stopped waiting.
 *
 * Both lock the account before the session, as forgetting does, so they
 * cannot deadlock with it.
 */

// $1 name, $2 description, $3 teacher id, $4 type. Returns the new id, or no
// row when the account is anonymized.
export const CREATE_SESSION_SQL = `
    WITH requester AS (
        SELECT id
        FROM users
        WHERE id = $3
          AND anonymized_at IS NULL
        FOR SHARE
    )
    INSERT INTO sessions (name, descr, creator, time, status, type)
    SELECT $1, $2, requester.id, now(), 1, $4
    FROM requester
    RETURNING id;
`;

// $1 status, $2 phase id, $3 session id, $4 teacher id. Returns the session's
// id, or no row when the session does not exist, is not the teacher's, or the
// account is anonymized.
export const TRANSITION_SESSION_SQL = `
    WITH requester AS (
        SELECT id
        FROM users
        WHERE id = $4
          AND anonymized_at IS NULL
        FOR SHARE
    )
    UPDATE sessions AS s
    SET status = $1,
        current_stage = $2
    FROM requester
    WHERE s.id = $3
      AND s.creator = requester.id
    RETURNING s.id;
`;
