// Account creation for the bootstrap scripts (create-admin.js, create-user.js).
// The email identifies an account (#1067), compared ignoring letter case as
// users_mail_lower_unique does. The database client is passed in, so the
// scripts' logic runs in tests against a fake.

import bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 12;

export const ADMIN_REQUIRED_VARIABLES = Object.freeze([
  'ADMIN_FIRSTNAME',
  'ADMIN_LASTNAME',
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD'
]);

export const CREATE_USER_USAGE =
  'node scripts/create-user.js <firstname> <lastname> <email> <password> [role] [sex]';

function isUniqueViolation(err) {
  return err?.code === '23505';
}

function joinName(firstname, lastname) {
  return [firstname, lastname].filter(Boolean).join(' ').trim();
}

async function findAccountByEmail(db, email) {
  const result = await db.query(
    `
      SELECT id, mail
      FROM users
      WHERE lower(mail) = $1
      LIMIT 1
    `,
    [email]
  );

  return result.rows[0] || null;
}

/**
 * Reads the bootstrap administrator from the environment. `missing` lists
 * the required variables that are empty.
 */
export function readAdminConfig(env) {
  const values = {
    ADMIN_FIRSTNAME: (env.ADMIN_FIRSTNAME || '').trim(),
    ADMIN_LASTNAME: (env.ADMIN_LASTNAME || '').trim(),
    ADMIN_EMAIL: (env.ADMIN_EMAIL || '').trim().toLowerCase(),
    ADMIN_PASSWORD: env.ADMIN_PASSWORD || ''
  };

  return {
    config: {
      firstname: values.ADMIN_FIRSTNAME,
      lastname: values.ADMIN_LASTNAME,
      email: values.ADMIN_EMAIL,
      password: values.ADMIN_PASSWORD,
      sex: (env.ADMIN_SEX || 'M').trim()
    },
    missing: ADMIN_REQUIRED_VARIABLES.filter((name) => !values[name])
  };
}

/**
 * Creates the bootstrap administrator, or makes the account that already
 * has its email an active administrator with the configured profile and
 * password. Answers 'created', 'reconciled', or 'exists' when an account
 * with the email was created between the lookup and the insert (another
 * instance running the script at the same time).
 */
export async function reconcileAdmin(db, config, { hash = bcrypt.hash } = {}) {
  const passwordBcrypt = await hash(config.password, BCRYPT_ROUNDS);
  const fullName = joinName(config.firstname, config.lastname);
  const existing = await findAccountByEmail(db, config.email);

  if (existing) {
    await db.query(
      `
        UPDATE users
        SET firstname = $1,
            lastname = $2,
            name = $3,
            sex = $4,
            role = 'S',
            password_bcrypt = $5,
            auth_provider = 'local',
            active = true,
            email_confirmed = true,
            session_version = session_version + 1
        WHERE id = $6
      `,
      [config.firstname, config.lastname, fullName, config.sex, passwordBcrypt, existing.id]
    );

    return 'reconciled';
  }

  try {
    await db.query(
      `
        INSERT INTO users
          (firstname, lastname, name, pass, mail, sex, role, password_bcrypt, auth_provider, active, email_confirmed)
        VALUES
          ($1, $2, $3, '', $4, $5, 'S', $6, 'local', true, true)
      `,
      [config.firstname, config.lastname, fullName, config.email, config.sex, passwordBcrypt]
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      return 'exists';
    }

    throw err;
  }

  return 'created';
}

/**
 * Parses create-user.js arguments, or answers null when they are incomplete.
 * The email must contain "@", so that an older invocation that still passes
 * a national ID third is refused instead of stored as the email.
 */
export function parseCreateUserArgs(args) {
  const [firstname, lastname, email, password, role = 'A', sex = 'M'] = args;

  if (!firstname || !lastname || !email || !password || !email.includes('@')) {
    return null;
  }

  return {
    firstname,
    lastname,
    email: email.trim().toLowerCase(),
    password,
    role,
    sex
  };
}

/**
 * Creates the user unless an account already has its email. Answers
 * { status: 'created' } or { status: 'exists', existingMail }, where
 * existingMail is the email as stored, which may differ in letter case.
 */
export async function createUserIfMissing(db, user, { hash = bcrypt.hash } = {}) {
  const existing = await findAccountByEmail(db, user.email);

  if (existing) {
    return { status: 'exists', existingMail: existing.mail };
  }

  const passwordBcrypt = await hash(user.password, BCRYPT_ROUNDS);

  try {
    await db.query(
      `
        INSERT INTO users
          (firstname, lastname, name, mail, sex, role, password_bcrypt, auth_provider, active)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, 'local', true)
      `,
      [
        user.firstname,
        user.lastname,
        joinName(user.firstname, user.lastname),
        user.email,
        user.sex,
        user.role,
        passwordBcrypt
      ]
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { status: 'exists', existingMail: null };
    }

    throw err;
  }

  return { status: 'created' };
}
