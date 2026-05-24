import { query } from '../config/database.js';
import { hashPassword, verifyPassword, generateResetToken } from './password.service.js';

function mapUser(row) {
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    rut: row.rut,
    email: row.mail,
    sex: row.sex,
    role: row.role,
    preferredLocale: row.preferred_locale,
    isActive: row.active !== false && row.email_confirmed !== false,
    emailConfirmed: row.email_confirmed !== false,
    authProvider: row.auth_provider || 'local',
    passwordHash: row.password_bcrypt
  };
}

async function findById(id) {
  const result = await query(
    `
      SELECT id, name, rut, mail, sex, role, preferred_locale, active, email_confirmed, auth_provider, password_bcrypt
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  return mapUser(result.rows[0]);
}

async function findByLogin(login) {
  const normalized = String(login || '').trim().toLowerCase();

  const result = await query(
    `
      SELECT id, name, rut, mail, sex, role, preferred_locale, active, email_confirmed, auth_provider, password_bcrypt
      FROM users
      WHERE lower(mail) = $1 OR lower(rut) = $1
      LIMIT 1
    `,
    [normalized]
  );

  return mapUser(result.rows[0]);
}

async function findByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();

  const result = await query(
    `
      SELECT id, name, rut, mail, sex, role, preferred_locale, active, email_confirmed, auth_provider, password_bcrypt
      FROM users
      WHERE lower(mail) = $1
      LIMIT 1
    `,
    [normalized]
  );

  return mapUser(result.rows[0]);
}

async function authenticateLocal(login, password) {
  const user = await findByLogin(login);

  if (!user) {
    return null;
  }

  if (!user.isActive) {
    return user;
  }

  const ok = await verifyPassword(password, user.passwordHash);

  if (!ok) {
    return null;
  }

  await touchLastLogin(user.id);

  return user;
}

async function touchLastLogin(userId) {
  await query(
    `
      UPDATE users
      SET last_login_at = NOW()
      WHERE id = $1
    `,
    [userId]
  );
}

async function createUser({ name, lastname, dni, email, gender, password, preferredLocale = 'en_US', role = 'A' }) {
  const fullName = `${name} ${lastname}`.trim();
  const passwordHash = await hashPassword(password);

  const result = await query(
    `
      INSERT INTO users
        (name, rut, pass, mail, sex, role, preferred_locale, password_bcrypt, auth_provider, active)
      VALUES
        ($1, $2, '', $3, $4, $5, $6, $7, 'local', true)
      RETURNING id, name, rut, mail, sex, role, preferred_locale, active, auth_provider, password_bcrypt
    `,
    [fullName, dni, email, gender, role, preferredLocale, passwordHash]
  );

  return mapUser(result.rows[0]);
}

async function createPasswordReset(email) {
  const token = generateResetToken();

  await query(
    `
      INSERT INTO pass_reset (mail, token, ctime)
      VALUES ($1, $2, NOW())
    `,
    [email, token]
  );

  return token;
}

async function findPasswordResetByToken(token) {
  const result = await query(
    `
      SELECT id, mail, token, ctime
      FROM pass_reset
      WHERE token = $1
        AND token_purpose = 'password_reset'
      ORDER BY ctime DESC
      LIMIT 1
    `,
    [token]
  );

  return result.rows[0] || null;
}

async function updatePasswordByEmail(email, password) {
  const passwordHash = await hashPassword(password);

  await query(
    `
      UPDATE users
      SET password_bcrypt = $2,
          auth_provider = 'local'
      WHERE lower(mail) = lower($1)
    `,
    [email, passwordHash]
  );
}

async function deletePasswordResetToken(token) {
  await query(
    `
      DELETE FROM pass_reset
      WHERE token = $1
        AND token_purpose = 'password_reset'
    `,
    [token]
  );
}

const userService = {
  findById,
  findByLogin,
  findByEmail,
  authenticateLocal,
  createUser,
  createPasswordReset,
  findPasswordResetByToken,
  updatePasswordByEmail,
  deletePasswordResetToken
};

export {
  findById,
  findByLogin,
  findByEmail,
  authenticateLocal,
  createUser,
  createPasswordReset,
  findPasswordResetByToken,
  updatePasswordByEmail,
  deletePasswordResetToken
};
export default userService;
