import express from 'express';

import requireManagementRole from '../middleware/requireManagementRole.js';
import { csrfTokenHandler } from '../middleware/csrfProtection.js';

const router = express.Router();

router.get('/mng/api/csrf-token', requireManagementRole, csrfTokenHandler);

export default router;
