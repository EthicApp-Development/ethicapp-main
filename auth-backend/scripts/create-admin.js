import 'dotenv/config';

import db from '../config/database.js';
import { ADMIN_REQUIRED_VARIABLES, readAdminConfig, reconcileAdmin } from './lib/bootstrap-accounts.js';

const OUTCOME_MESSAGES = {
  created: 'Admin created',
  reconciled: 'Admin reconciled and activated',
  exists: 'Admin already exists, created at the same time by another instance'
};

async function main() {
  const { config, missing } = readAdminConfig(process.env);

  if (missing.length > 0) {
    console.error(`
Missing required admin environment variables: ${missing.join(', ')}

Required:
${ADMIN_REQUIRED_VARIABLES.map((name) => `  ${name}`).join('\n')}

Optional:
  ADMIN_SEX (default: M)

An account that already has ADMIN_EMAIL (ignoring letter case) is made an
active administrator with these values.
`);
    process.exit(1);
  }

  const outcome = await reconcileAdmin(db, config);

  console.log(`✔ ${OUTCOME_MESSAGES[outcome]}: ${config.email}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
