import express from 'express';

import { getHealthCheckTargets } from '../config/health-targets.js';
import { createSingleFlightCache } from '../helpers/single-flight-cache.js';
import requireManagementRole from '../middleware/requireManagementRole.js';
import { createDnsHealthService } from '../services/health-dns.service.js';

const HEALTH_CHECK_COOLDOWN_MS = 5000;

export function createHealthRouter({
  requireManagementRoleMiddleware = requireManagementRole,
  getHealthCheckTargetsService = getHealthCheckTargets,
  dnsHealthService = createDnsHealthService(),
  cooldownMs = HEALTH_CHECK_COOLDOWN_MS,
  now = Date.now
} = {}) {
  const router = express.Router();

  // Targets always come from the configured allowlist; the request body is
  // never read, so callers cannot make the console contact other hosts.
  const runDnsCheck = createSingleFlightCache(
    () => dnsHealthService.checkTargets(getHealthCheckTargetsService()),
    { cooldownMs, now }
  );

  router.post('/mng/api/health/dns', requireManagementRoleMiddleware, async (req, res, next) => {
    try {
      return res.status(200).json(await runDnsCheck());
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export default createHealthRouter();
