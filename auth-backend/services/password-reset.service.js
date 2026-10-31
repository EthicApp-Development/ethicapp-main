import defaultDb from '../config/database.js';

/**
 * Password recovery's database work (POST /reset-password).
 *
 * The token is checked twice. First without a lock, so an invalid link is
 * refused before the password is hashed. Then again in the transaction that
 * stores the password, after the account row is locked FOR UPDATE, the lock
 * an administrator setting the password also takes (#889). An administrator
 * who set the password while the recovery was hashing deleted the token, so
 * the recovery is refused and the administrator's password stays. A recovery
 * that locked the account first completes, and the administrator's password,
 * set after it, wins. Two recoveries with the same link end the same way:
 * the second finds the token gone.
 */

export const RESET_PASSWORD_REFUSALS = Object.freeze({
  invalidOrExpiredToken: 'invalidOrExpiredToken'
});

const VALID_TOKEN_SQL = `
  SELECT mail
  FROM pass_reset
  WHERE token = $1
    AND token_purpose = 'password_reset'
    AND ctime > NOW() - ($2 * INTERVAL '1 minute')
`;

/**
 * @param {Object} [options]
 * @param {import('pg').Pool} [options.pool]
 * @param {{ error: Function }} [options.logger]
 */
export function createPasswordResetService({ pool = defaultDb.pool, logger = console } = {}) {
  /**
   * The email a valid, unexpired recovery token belongs to, or null.
   * @param {{ tokenDigest: string, ttlMinutes: number }} options
   * @returns {Promise<string|null>}
   */
  async function findValidTokenMail({ tokenDigest, ttlMinutes }) {
    const result = await pool.query(`${VALID_TOKEN_SQL} LIMIT 1`, [tokenDigest, ttlMinutes]);
    return result.rows[0]?.mail ?? null;
  }

  /**
   * Stores the password of the token's account, in one transaction: locks
   * the account, checks the token again, stores the hash (confirming a
   * pending sign-up, as recovery does), increments session_version and
   * deletes the account's recovery tokens.
   * @param {{ tokenDigest: string, ttlMinutes: number, passwordHash: string }} options
   * @returns {Promise<null|string>} null when the password was stored, or a
   *     RESET_PASSWORD_REFUSALS code.
   */
  async function resetPassword({ tokenDigest, ttlMinutes, passwordHash }) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const userResult = await client.query(
        `
          SELECT u.id, u.mail
          FROM users u
          WHERE lower(u.mail) = (
              SELECT lower(r.mail)
              FROM pass_reset r
              WHERE r.token = $1
                AND r.token_purpose = 'password_reset'
              LIMIT 1
          )
            AND (u.active = true OR u.email_confirmed = false)
          LIMIT 1
          FOR UPDATE OF u
        `,
        [tokenDigest]
      );

      // Read after the lock: an administrator's change committed meanwhile
      // has deleted the token.
      const tokenResult = userResult.rowCount === 0
        ? { rowCount: 0 }
        : await client.query(
          `${VALID_TOKEN_SQL} AND lower(mail) = lower($3) LIMIT 1`,
          [tokenDigest, ttlMinutes, userResult.rows[0].mail]
        );

      if (tokenResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return RESET_PASSWORD_REFUSALS.invalidOrExpiredToken;
      }

      const user = userResult.rows[0];

      await client.query(
        `
          UPDATE users
          SET password_bcrypt = $1,
              active = CASE WHEN email_confirmed = false THEN true ELSE active END,
              email_confirmed = true,
              session_version = session_version + 1
          WHERE id = $2
        `,
        [passwordHash, user.id]
      );

      await client.query(
        `
          DELETE FROM pass_reset
          WHERE lower(mail) = lower($1)
            AND token_purpose = 'password_reset'
        `,
        [user.mail]
      );

      await client.query('COMMIT');
      return null;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        logger.error('RESET PASSWORD ROLLBACK ERROR:', { message: rollbackError?.message });
      }
      throw error;
    } finally {
      client.release();
    }
  }

  return { findValidTokenMail, resetPassword };
}

export default createPasswordResetService();
