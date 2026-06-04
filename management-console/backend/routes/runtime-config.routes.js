import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import requireManagementRole from '../middleware/requireManagementRole.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runtimeConfigPath = path.join(__dirname, '../../frontend/dist/runtime-config.js');

function buildRuntimeConfigScript() {
  const config = {
    recaptchaProvider: process.env.RECAPTCHA_PROVIDER || '',
    recaptchaSiteKey: process.env.VITE_RECAPTCHA_SITE_KEY || ''
  };

  return `window.__MNG_RUNTIME_CONFIG__ = ${JSON.stringify(config)};\n`;
}

router.get('/mng/runtime-config.js', requireManagementRole, (req, res) => {
  res.type('application/javascript');
  res.set('Cache-Control', 'no-store');
  res.sendFile(runtimeConfigPath, (error) => {
    if (error && !res.headersSent) {
      res.send(buildRuntimeConfigScript());
    }
  });
});

export default router;
