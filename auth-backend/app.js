const path = require('path');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;

const userService = require('./services/user.service');

const viewRoutes = require('./routes/view.routes');
const authRoutes = require('./routes/auth.routes');

const app = express();

// --------------------------------------------------
// Basic Express setup
// --------------------------------------------------
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --------------------------------------------------
// Parsers
// --------------------------------------------------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --------------------------------------------------
// Static assets
// --------------------------------------------------
app.use(
  '/auth-assets',
  express.static(path.join(__dirname, 'public', 'app', 'assets'))
);

app.use(express.static(path.join(__dirname, 'public', 'app')));

// --------------------------------------------------
// Session
// --------------------------------------------------
app.use(
  session({
    name: process.env.SESSION_COOKIE_NAME || 'auth.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 8 // 8 hours
    }
  })
);

// --------------------------------------------------
// Passport
// --------------------------------------------------
app.use(passport.initialize());
app.use(passport.session());

passport.use(
  new LocalStrategy(
    {
      usernameField: 'username',
      passwordField: 'password'
    },
    async function verify(username, password, done) {
      try {
        const user = await userService.authenticateLocal(username, password);

        if (!user) {
          return done(null, false, {
            message: 'Credenciales inválidas.'
          });
        }

        if (!user.is_active) {
          return done(null, false, {
            message: 'La cuenta no está activa.'
          });
        }

        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }
  )
);

passport.serializeUser(function serializeUser(user, done) {
  done(null, user.id);
});

passport.deserializeUser(async function deserializeUser(id, done) {
  try {
    const user = await userService.findById(id);

    if (!user) {
      return done(null, false);
    }

    return done(null, user);
  } catch (error) {
    return done(error);
  }
});

// --------------------------------------------------
// Expose auth state to views
// --------------------------------------------------
app.use(function exposeAuthState(req, res, next) {
  res.locals.currentUser = req.user || null;
  res.locals.isAuthenticated = !!req.user;
  next();
});

// --------------------------------------------------
// Routes
// --------------------------------------------------
app.use('/', viewRoutes);
app.use('/api/auth', authRoutes);

// --------------------------------------------------
// Health check
// --------------------------------------------------
app.get('/health', function healthHandler(req, res) {
  res.status(200).json({ ok: true });
});

// --------------------------------------------------
// Session check for nginx auth_request
// --------------------------------------------------
app.get('/auth/session/check', function sessionCheckHandler(req, res) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).end();
  }

  res.set('X-User-Id', String(req.user.id));
  res.set('X-User-Role', String(req.user.role || 'user'));
  res.set('X-User-Email', String(req.user.email || ''));

  return res.status(200).end();
});

// --------------------------------------------------
// 404
// --------------------------------------------------
app.use(function notFoundHandler(req, res) {
  if (req.path.startsWith('/auth/') || req.path === '/login' || req.path === '/register' || req.path === '/forgot' || req.path === '/reset-password') {
    return res.status(404).send('Not found');
  }

  return res.status(404).send('Not found');
});

// --------------------------------------------------
// Error handler
// --------------------------------------------------
app.use(function errorHandler(err, req, res, next) {
  console.error(err);

  if (res.headersSent) {
    return next(err);
  }

  return res.status(500).json({
    error: 'Internal server error'
  });
});


module.exports = app;