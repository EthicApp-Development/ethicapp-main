require('dotenv').config();

const pool = require('../config/database.js');
const bcrypt = require('bcrypt');

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

  const existing = await pool.query(
    `
      SELECT id, mail, rut
      FROM users
      WHERE mail = $1 OR rut = $2
      LIMIT 1
    `,
    [email, rut]
  );

  if (existing.rowCount > 0) {
    console.log(`✔ Admin already exists: ${email}`);
    process.exit(0);
  }

  const hash = await bcrypt.hash(password, 12);
  const fullName = [firstname, lastname].filter(Boolean).join(' ').trim();

  await pool.query(
    `
      INSERT INTO users
        (firstname, lastname, name, rut, pass, mail, sex, role, password_bcrypt, auth_provider, active)
      VALUES
        ($1, $2, $3, $4, '', $5, $6, $7, $8, 'local', true)
    `,
    [firstname, lastname, fullName, rut, email, sex, 'S', hash]
  );

  console.log(`✔ Admin created: ${email}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});