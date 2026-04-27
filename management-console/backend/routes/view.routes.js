import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import requireManagementRole from '../middleware/requireManagementRole.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const spaIndexPath = path.join(__dirname, '../../frontend/dist/index.html');

router.get(['/mng', '/mng/'], requireManagementRole, (req, res) => {
  res.sendFile(spaIndexPath);
});

router.get('/mng/*path', requireManagementRole, (req, res) => {
  res.sendFile(spaIndexPath);
});

export default router;
