import dotenv from 'dotenv';
import app from './app.js';
import { getHealthCheckTargets } from './config/health-targets.js';

dotenv.config();

const port = Number(process.env.MNG_PORT || 8504);
const healthCheckTargets = getHealthCheckTargets();

app.listen(port, () => {
  console.log(`Management console backend listening on port ${port}`);
  console.log(`Health check targets configured: ${healthCheckTargets.length}`);
});
