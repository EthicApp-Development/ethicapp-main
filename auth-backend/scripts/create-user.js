require('dotenv').config();

const pool = require('../config/database');
const bcrypt = require('bcrypt');

async function main() {
  const [
    name,
    rut,
    email,
    password,
    role = 'A',
    sex = 'M'
  ] = process.argv.slice(2);

  if (!name || !rut || !email || !password) {
    console.error(`
Uso:
node scripts/create-user.js <name> <rut> <email> <password> [role] [sex]
`);
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);

  await pool.query(
    `
    INSERT INTO users
      (name, rut, pass, mail, sex, role, password_bcrypt, auth_provider, active)
    VALUES
      ($1, $2, '', $3, $4, $5, $6, 'local', true)
    `,
    [name, rut, email, sex, role, hash]
  );

  console.log(`✔ Usuario creado: ${email}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});