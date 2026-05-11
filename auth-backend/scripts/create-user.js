import 'dotenv/config';

import bcrypt from 'bcrypt';

import db from '../config/database.js';

async function main() {
  const [
    firstname,
    lastname,
    rut,
    email,
    password,
    role = 'A',
    sex = 'M'
  ] = process.argv.slice(2);

  if (!firstname || !lastname || !rut || !email || !password) {
    console.error(`
Uso:
node scripts/create-user.js <firstname> <lastname> <rut> <email> <password> [role] [sex]
`);
    process.exit(1);
  }

  const fullName = [firstname, lastname].filter(Boolean).join(' ').trim();
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await db.query(
    `
      SELECT id
      FROM users
      WHERE mail = $1 OR rut = $2
      LIMIT 1
    `,
    [normalizedEmail, rut]
  );

  if (existing.rowCount > 0) {
    console.log(`✔ User already exists: ${normalizedEmail}`);
    process.exit(0);
  }

  const hash = await bcrypt.hash(password, 12);

  await db.query(
    `
      INSERT INTO users
        (firstname, lastname, name, rut, mail, sex, role, password_bcrypt, auth_provider, active)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, 'local', true)
    `,
    [firstname, lastname, fullName, rut, normalizedEmail, sex, role, hash]
  );

  console.log(`✔ User created: ${normalizedEmail}`);
  process.exit(0);
}

main().catch((err) => {
  if (err.code === '23505') {
    console.log('✔ User already exists');
    process.exit(0);
  }

  console.error(err);
  process.exit(1);
});
