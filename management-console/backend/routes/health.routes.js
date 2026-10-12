import express from 'express';

import { getHealthCheckTargets } from '../config/health-targets.js';
import { createSingleFlightCache } from '../helpers/single-flight-cache.js';
import requireManagementRole from '../middleware/requireManagementRole.js';
import { createConnectivityHealthService } from '../services/health-connectivity.service.js';
import { createDnsHealthService } from '../services/health-dns.service.js';

const HEALTH_CHECK_COOLDOWN_MS = 5000;

export function createHealthRouter({
  requireManagementRoleMiddleware = requireManagementRole,
  getHealthCheckTargetsService = getHealthCheckTargets,
  dnsHealthService = createDnsHealthService(),
  connectivityHealthService = createConnectivityHealthService(),
  cooldownMs = HEALTH_CHECK_COOLDOWN_MS,
  now = Date.now
} = {}) {
  const router = express.Router();

  // Targets always come from the configured allowlist; the request body is
  // never read, so callers cannot make the console contact other hosts.
  function registerCheck(path, service) {
    const runCheck = createSingleFlightCache(
      () => service.checkTargets(getHealthCheckTargetsService()),
      { cooldownMs, now }
    );

    router.post(path, requireManagementRoleMiddleware, async (req, res, next) => {
      try {
        return res.status(200).json(await runCheck());
      } catch (error) {
        return next(error);
      }
    });
  }

  registerCheck('/mng/api/health/dns', dnsHealthService);
  registerCheck('/mng/api/health/connectivity', connectivityHealthService);

  return router;
}

export default createHealthRouter();
