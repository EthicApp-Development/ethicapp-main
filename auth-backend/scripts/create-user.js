import 'dotenv/config';

import db from '../config/database.js';
import { CREATE_USER_USAGE, createUserIfMissing, parseCreateUserArgs } from './lib/bootstrap-accounts.js';

async function main() {
  const user = parseCreateUserArgs(process.argv.slice(2));

  if (!user) {
    console.error(`
Usage:
${CREATE_USER_USAGE}
`);
    process.exit(1);
  }

  const result = await createUserIfMissing(db, user);

  if (result.status === 'exists') {
    const storedAs = result.existingMail && result.existingMail !== user.email
      ? ` (stored as ${result.existingMail})`
      : '';
    console.log(`✔ User already exists with email ${user.email}${storedAs}; nothing changed`);
    process.exit(0);
  }

  console.log(`✔ User created: ${user.email}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
