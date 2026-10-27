import express from 'express';

import requireManagementRole from '../middleware/requireManagementRole.js';
import aiServicesStore, {
  AiServicesValidationError,
  parseConnectionInput,
  parsePolicyInput
} from '../services/ai-services.service.js';
import {
  fetchAiServicesCatalogFromEthicapp,
  testAiAdditionsConnectionInEthicapp
} from '../services/ethicapp.service.js';
import { createSensitiveActionVerifier } from '../services/sensitive-action.service.js';

const BASE_PATH = '/mng/api/ai-services';

// Canonical locale rule (AGENTS.md §9): Spanish only when explicitly preferred.
export function normalizeLocale(value) {
  const primary = String(value || '').split(',')[0].split(';')[0].trim().toLowerCase();
  return /^es([-_]|$)/.test(primary) ? 'es_CL' : 'en_US';
}

function requestIdentity(req) {
  return {
    cookie: req.headers.cookie,
    userId: req.session.uid,
    userRole: req.session.role,
    language: req.headers['accept-language']
  };
}

function authenticatedUserId(req) {
  const userId = Number(req.session.uid);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function sendValidationError(res, error) {
  return res.status(400).json({ error: error.code, ...error.details });
}

export function createAiServicesRouter({
  requireManagementRoleMiddleware = requireManagementRole,
  store = aiServicesStore,
  fetchCatalogService = fetchAiServicesCatalogFromEthicapp,
  testConnectionService = testAiAdditionsConnectionInEthicapp,
  verifySensitiveAction = createSensitiveActionVerifier()
} = {}) {
  const router = express.Router();

  router.use(BASE_PATH, requireManagementRoleMiddleware);

  router.get(`${BASE_PATH}/connection`, async (req, res, next) => {
    try {
      return res.status(200).json({ connection: await store.getConnection() });
    } catch (error) {
      return next(error);
    }
  });

  // The three writes below decide whether and where the installation sends
  // data to external AI services, so each one requires the administrator's
  // step-up confirmation (services/sensitive-action.service.js) in the body:
  // `passkey_assertion`, or `admin_password` plus `recaptcha_token`. The
  // input (and, for a policy, its ids against the catalog) is checked first,
  // so a request that would be refused anyway never consumes a confirmation.

  router.put(`${BASE_PATH}/connection`, async (req, res, next) => {
    try {
      const input = parseConnectionInput(req.body);

      if (!(await verifySensitiveAction(req, res))) {
        return undefined;
      }

      const connection = await store.saveConnection({ ...input, userId: authenticatedUserId(req) });
      return res.status(200).json({ connection });
    } catch (error) {
      if (error instanceof AiServicesValidationError) {
        return sendValidationError(res, error);
      }
      return next(error);
    }
  });

  // Removing the connection stops every AI call, including in running
  // sessions.
  router.delete(`${BASE_PATH}/connection`, async (req, res, next) => {
    try {
      if (!(await verifySensitiveAction(req, res))) {
        return undefined;
      }

      const removed = await store.deleteConnection();
      return res.status(200).json({ removed, connection: null });
    } catch (error) {
      return next(error);
    }
  });

  router.post(`${BASE_PATH}/connection/test`, async (req, res, next) => {
    try {
      const input = parseConnectionInput(req.body);
      const result = await testConnectionService({ ...input, ...requestIdentity(req) });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof AiServicesValidationError) {
        return sendValidationError(res, error);
      }
      return next(error);
    }
  });

  router.get(`${BASE_PATH}/catalog`, async (req, res, next) => {
    try {
      const locale = normalizeLocale(req.query.locale || req.headers['accept-language']);
      const result = await fetchCatalogService({ locale, ...requestIdentity(req) });
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  router.get(`${BASE_PATH}/policy`, async (req, res, next) => {
    try {
      return res.status(200).json(await store.getPolicyHistory());
    } catch (error) {
      return next(error);
    }
  });

  // Saving always appends a new version. Ids are checked against the live
  // catalog: allowed ids must be services it offers, and switched-off ids
  // (#864) must be EthicApp adapters of the allowed services. When the
  // catalog cannot be read, only an empty version is accepted, so an operator
  // can always turn AI off.
  router.post(`${BASE_PATH}/policy`, async (req, res, next) => {
    try {
      const input = parsePolicyInput(req.body);

      if (input.allowedServiceIds.length > 0 || input.disabledAdapterIds.length > 0) {
        const catalog = await fetchCatalogService({
          locale: normalizeLocale(req.headers['accept-language']),
          ...requestIdentity(req)
        });

        if (!catalog.ok) {
          return res.status(409).json({ error: 'CATALOG_UNAVAILABLE', catalogError: catalog.error });
        }

        const knownIds = new Set(catalog.services.map((service) => service.id));
        const unknownServiceIds = input.allowedServiceIds.filter((id) => !knownIds.has(id));

        if (unknownServiceIds.length > 0) {
          return res.status(400).json({ error: 'UNKNOWN_SERVICE_IDS', unknownServiceIds });
        }

        const allowedIds = new Set(input.allowedServiceIds);
        const switchableAdapterIds = new Set(catalog.services
          .filter((service) => allowedIds.has(service.id))
          .flatMap((service) => service.adapters.map((adapter) => adapter.id)));
        const unknownAdapterIds = input.disabledAdapterIds.filter((id) => !switchableAdapterIds.has(id));

        if (unknownAdapterIds.length > 0) {
          return res.status(400).json({ error: 'UNKNOWN_ADAPTER_IDS', unknownAdapterIds });
        }
      }

      if (!(await verifySensitiveAction(req, res))) {
        return undefined;
      }

      const version = await store.createPolicyVersion({ ...input, userId: authenticatedUserId(req) });
      return res.status(201).json({ version });
    } catch (error) {
      if (error instanceof AiServicesValidationError) {
        return sendValidationError(res, error);
      }
      return next(error);
    }
  });

  return router;
}

export default createAiServicesRouter();
