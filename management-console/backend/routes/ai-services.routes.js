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

const BASE_PATH = '/mng/api/ai-services';

// Canonical locale rule (AGENTS.md §9): Spanish only when explicitly preferred.
export function normalizeLocale(value) {
  const primary = String(value || '').split(',')[0].trim().toLowerCase();
  return primary === 'es' || primary.startsWith('es-') || primary.startsWith('es_') ? 'es_CL' : 'en_US';
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
  testConnectionService = testAiAdditionsConnectionInEthicapp
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

  router.put(`${BASE_PATH}/connection`, async (req, res, next) => {
    try {
      const input = parseConnectionInput(req.body);
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
  // sessions, so the request must confirm it explicitly.
  router.delete(`${BASE_PATH}/connection`, async (req, res, next) => {
    try {
      if (req.body?.confirm !== true) {
        return res.status(400).json({ error: 'CONFIRMATION_REQUIRED' });
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
  // catalog; when the catalog cannot be read, only an empty set is accepted,
  // so an operator can always turn AI off.
  router.post(`${BASE_PATH}/policy`, async (req, res, next) => {
    try {
      const input = parsePolicyInput(req.body);

      if (input.allowedServiceIds.length > 0) {
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
