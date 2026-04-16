require('dotenv').config();

const pool = require('../config/database.js');
const bcrypt = require('bcrypt');

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

  const hash = await bcrypt.hash(password, 12);
  const fullName = [firstname, lastname].filter(Boolean).join(' ').trim();

  await pool.query(
    `
      INSERT INTO users
        (firstname, lastname, name, rut, mail, sex, role, password_bcrypt, auth_provider, active)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, 'local', true)
    `,
    [firstname, lastname, fullName, rut, email, sex, role, hash]
  );

  console.log(`✔ Usuario creado: ${email}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});