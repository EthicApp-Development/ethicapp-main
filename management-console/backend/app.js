import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';

import { getManagementSessionCookieMaxAgeMs } from './config/session.js';
import hydrateSessionFromAuthProxy from './middleware/hydrateSessionFromAuthProxy.js';
import { csrfProtection } from './middleware/csrfProtection.js';
import csrfRoutes from './routes/csrf.routes.js';
import institutionRoutes from './routes/institution.routes.js';
import runtimeConfigRoutes from './routes/runtime-config.routes.js';
import profileRoutes from './routes/profile.routes.js';
import viewRoutes from './routes/view.routes.js';
import usersRoutes from './routes/users.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use(
  session({
    name: process.env.MNG_SESSION_COOKIE_NAME || 'ethicapp.mng.sid',
    secret: process.env.MNG_SESSION_SECRET || process.env.SESSION_SECRET || 'development-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: getManagementSessionCookieMaxAgeMs()
    }
  })
);

app.use(hydrateSessionFromAuthProxy);
app.use(runtimeConfigRoutes);
app.use('/mng/assets', express.static(path.join(__dirname, '../frontend/dist/assets')));
app.use(csrfRoutes);
app.use('/mng/api', csrfProtection);
app.use(institutionRoutes);
app.use(profileRoutes);
app.use(usersRoutes);
app.use(viewRoutes);

app.get('/mng/health', (req, res) => {
  res.status(200).json({ ok: true });
});

app.use((err, req, res, next) => {
  console.error(err);

  if (res.headersSent) {
    return next(err);
  }

  return res.status(500).json({ error: 'Internal server error' });
});

export default app;
