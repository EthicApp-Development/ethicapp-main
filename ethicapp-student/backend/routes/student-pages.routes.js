import path from 'path';
import express, { Router } from 'express';
import { getRoleHome } from '../helpers/role-home.js';
import { requireLegacyAuth, requireStudentRole } from '../middleware/index.js';

/**
 * Sends professors and administrators who open a student page to their own
 * home. Roles without a home fall through to requireStudentRole (403).
 */
function redirectNonStudentsHome(req, res, next) {
  const role = req.session?.role;
  const home = role === 'A' ? null : getRoleHome(role);

  if (home) {
    return res.redirect(302, home);
  }

  return next();
}

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

  router.use(requireLegacyAuth, redirectNonStudentsHome, requireStudentRole);
  router.use(express.static(frontendDist));

  router.get('/*splat', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });

  return router;
}
