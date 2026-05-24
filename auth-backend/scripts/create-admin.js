import 'dotenv/config';

import bcrypt from 'bcrypt';

import db from '../config/database.js';

async function main() {
  const firstname = (process.env.ADMIN_FIRSTNAME || '').trim();
  const lastname = (process.env.ADMIN_LASTNAME || '').trim();
  const rut = (process.env.ADMIN_DNI || '').trim();
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  const sex = (process.env.ADMIN_SEX || 'M').trim();

  if (!firstname || !lastname || !rut || !email || !password) {
    console.error(`
Missing required admin environment variables.

Required:
  ADMIN_FIRSTNAME
  ADMIN_LASTNAME
  ADMIN_DNI
  ADMIN_EMAIL
  ADMIN_PASSWORD

Optional:
  ADMIN_SEX (default: M)
`);
    process.exit(1);
  }

  const existingByEmail = await db.query(
    `
      SELECT id, mail, rut
      FROM users
      WHERE mail = $1
      LIMIT 1
    `,
    [email]
  );

  const hash = await bcrypt.hash(password, 12);
  const fullName = [firstname, lastname].filter(Boolean).join(' ').trim();

  if (existingByEmail.rowCount > 0) {
    await db.query(
      `
        UPDATE users
        SET firstname = $1,
            lastname = $2,
            name = $3,
            rut = $4,
            sex = $5,
            role = 'S',
            password_bcrypt = $6,
            auth_provider = 'local',
            active = true,
            email_confirmed = true
        WHERE mail = $7
      `,
      [firstname, lastname, fullName, rut, sex, hash, email]
    );

    console.log(`✔ Admin reconciled and activated: ${email}`);
    process.exit(0);
  }

  const existingByRut = await db.query(
    `
      SELECT id, mail, rut
      FROM users
      WHERE rut = $1
      LIMIT 1
    `,
    [rut]
  );

  if (existingByRut.rowCount > 0) {
    console.error(
      `Cannot create admin ${email}: ADMIN_DNI is already used by ${existingByRut.rows[0].mail}.`
    );
    process.exit(1);
  }

  await db.query(
    `
      INSERT INTO users
        (firstname, lastname, name, rut, pass, mail, sex, role, password_bcrypt, auth_provider, active, email_confirmed)
      VALUES
        ($1, $2, $3, $4, '', $5, $6, $7, $8, 'local', true, true)
    `,
    [firstname, lastname, fullName, rut, email, sex, 'S', hash]
  );

  console.log(`✔ Admin created: ${email}`);
  process.exit(0);
}

main().catch((err) => {
  if (err.code === '23505') {
    console.log(`✔ Admin already exists: ${(process.env.ADMIN_EMAIL || '').trim().toLowerCase()}`);
    process.exit(0);
  }

  console.error(err);
  process.exit(1);
});
