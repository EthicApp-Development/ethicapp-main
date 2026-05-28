import express from 'express';

import requireManagementRole from '../middleware/requireManagementRole.js';
import {
  getInstitutionLogo,
  getInstitutionSettings,
  updateInstitutionSettings
} from '../services/institution.service.js';

export function createInstitutionRouter({
  requireManagementRoleMiddleware = requireManagementRole,
  getInstitutionSettingsService = getInstitutionSettings,
  updateInstitutionSettingsService = updateInstitutionSettings,
  getInstitutionLogoService = getInstitutionLogo
} = {}) {
  const router = express.Router();

  router.get('/mng/api/institution', requireManagementRoleMiddleware, async (req, res, next) => {
    try {
      const institution = await getInstitutionSettingsService();
      return res.status(200).json(institution);
    } catch (error) {
      return next(error);
    }
  });

  router.put('/mng/api/institution', requireManagementRoleMiddleware, async (req, res, next) => {
    try {
      const institution = await updateInstitutionSettingsService(req.body);
      return res.status(200).json(institution);
    } catch (error) {
      const errorsByCode = {
        MISSING_INSTITUTION_NAME: 400,
        INVALID_CONTACT_TYPE: 400,
        INVALID_LOGO_TYPE: 400,
        INVALID_LOGO_DATA: 400,
        LOGO_SIZE_LIMIT_EXCEEDED: 400
      };

      if (errorsByCode[error.message]) {
        return res.status(errorsByCode[error.message]).json({
          error: error.message
        });
      }

      return next(error);
    }
  });

  router.get('/mng/api/institution/logo', requireManagementRoleMiddleware, async (req, res, next) => {
    try {
      const logo = await getInstitutionLogoService();

      if (!logo) {
        return res.status(404).json({ error: 'Logo not found' });
      }

      res.set('Content-Type', logo.mimeType);
      res.set('Cache-Control', 'private, max-age=300');
      if (logo.updatedAt) {
        res.set('Last-Modified', new Date(logo.updatedAt).toUTCString());
      }
      return res.send(Buffer.from(logo.bytes));
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export default createInstitutionRouter();
