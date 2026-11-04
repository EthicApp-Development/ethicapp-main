import path from 'path';
import express, { Router } from 'express';
import { requireLegacyAuth, requireStudentRole } from '../middleware/index.js';

/**
 * Serves the built student SPA. Only production reaches it: in development
 * NGINX sends /student/ to Vite. Every page and asset requires a student
 * session, except runtime-config.js, which NGINX serves without the session
 * check.
 * @param {object} options
 * @param {string} options.frontendDist Directory holding the built SPA.
 */
export function createStudentPagesRouter({ frontendDist }) {
  const router = Router();

  router.get('/runtime-config.js', (req, res, next) => {
    res.sendFile('runtime-config.js', { root: frontendDist }, (error) => {
      if (error && !res.headersSent) {
        next();
      }
    });
  });

  router.use(requireLegacyAuth, requireStudentRole);
  router.use(express.static(frontendDist));

  router.get('/*splat', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });

  return router;
}
