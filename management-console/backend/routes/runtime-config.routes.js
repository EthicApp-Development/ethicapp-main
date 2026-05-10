import express from 'express';

import requireManagementRole from '../middleware/requireManagementRole.js';

const router = express.Router();

router.get('/mng/runtime-config.js', requireManagementRole, (req, res) => {
  const config = {
    recaptchaSiteKey: process.env.VITE_RECAPTCHA_SITE_KEY || ''
  };

  res.type('application/javascript');
  res.set('Cache-Control', 'no-store');
  res.send([
    `window.__MNG_RUNTIME_CONFIG__ = ${JSON.stringify(config)};`,
    'console.debug("[management-console] runtime config loaded", {',
    '  recaptchaSiteKeyConfigured: Boolean(window.__MNG_RUNTIME_CONFIG__?.recaptchaSiteKey)',
    '});'
  ].join('\n'));
});

export default router;
