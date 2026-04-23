import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import session from 'express-session';

import studentRoutes from './routes/student.routes.js';
import { exposeLegacySession, hydrateLegacySession, requireLegacyAuth } from './middleware/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: process.env.ETHICAPP_STUDENT_SESSION_COOKIE_NAME || 'ethicapp.student.sid',
    secret: process.env.ETHICAPP_STUDENT_SESSION_SECRET || process.env.SESSION_SECRET || 'development-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

app.use(hydrateLegacySession);
app.use(exposeLegacySession);

// app.use((req, res, next) => {
//   console.log('[student-backend] incoming', {
//     method: req.method,
//     url: req.originalUrl,
//     xUserId: req.headers['x-user-id'],
//     xUserRole: req.headers['x-user-role'],
//     sessionUid: req.session?.uid,
//     sessionRole: req.session?.role
//   });
//   next();
// });

app.use('/student/api', studentRoutes);

app.get('/student/health', (req, res) => {
  res.status(200).json({ ok: true });
});

app.use('/student/assets', express.static(path.join(__dirname, '../frontend/dist/assets')));
app.use('/student', express.static(path.join(__dirname, '../frontend/dist')));

app.get('/student/*splat', requireLegacyAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);

  if (res.headersSent) {
    return next(err);
  }

  return res.status(500).json({ error: 'Internal server error' });
});

export default app;
