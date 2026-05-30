const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const ROLE_POLICIES = {
  S: {
    idleTimeoutMs: 2 * HOUR_MS,
    absoluteTimeoutMs: 8 * HOUR_MS
  },
  P: {
    idleTimeoutMs: 7 * DAY_MS,
    absoluteTimeoutMs: 30 * DAY_MS
  },
  A: {
    idleTimeoutMs: DAY_MS,
    absoluteTimeoutMs: 7 * DAY_MS
  }
};

function parsePositiveInteger(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0
    ? numberValue
    : fallback;
}

function getRoleSessionPolicy(role) {
  const normalizedRole = String(role || '').toUpperCase();
  const defaults = ROLE_POLICIES[normalizedRole] || ROLE_POLICIES.A;

  if (normalizedRole === 'S') {
    return {
      idleTimeoutMs: parsePositiveInteger(
        process.env.AUTH_SESSION_ADMIN_IDLE_TIMEOUT_MS,
        defaults.idleTimeoutMs
      ),
      absoluteTimeoutMs: parsePositiveInteger(
        process.env.AUTH_SESSION_ADMIN_ABSOLUTE_TIMEOUT_MS,
        defaults.absoluteTimeoutMs
      )
    };
  }

  if (normalizedRole === 'P') {
    return {
      idleTimeoutMs: parsePositiveInteger(
        process.env.AUTH_SESSION_PROFESSOR_IDLE_TIMEOUT_MS,
        defaults.idleTimeoutMs
      ),
      absoluteTimeoutMs: parsePositiveInteger(
        process.env.AUTH_SESSION_PROFESSOR_ABSOLUTE_TIMEOUT_MS,
        defaults.absoluteTimeoutMs
      )
    };
  }

  return {
    idleTimeoutMs: parsePositiveInteger(
      process.env.AUTH_SESSION_STUDENT_IDLE_TIMEOUT_MS,
      defaults.idleTimeoutMs
    ),
    absoluteTimeoutMs: parsePositiveInteger(
      process.env.AUTH_SESSION_STUDENT_ABSOLUTE_TIMEOUT_MS,
      defaults.absoluteTimeoutMs
    )
  };
}

function getDefaultAuthSessionMaxAgeMs() {
  const maxAbsoluteTimeoutMs = Math.max(
    ...Object.values(ROLE_POLICIES).map((policy) => policy.absoluteTimeoutMs)
  );

  return parsePositiveInteger(
    process.env.AUTH_SESSION_COOKIE_MAX_AGE_MS,
    maxAbsoluteTimeoutMs
  );
}

function getDefaultAuthSessionTtlSeconds() {
  return Math.ceil(getDefaultAuthSessionMaxAgeMs() / 1000);
}

function initializeSessionPolicy(req, role, nowMs = Date.now()) {
  if (!req.session) {
    return;
  }

  const policy = getRoleSessionPolicy(role);

  req.session.authPolicy = {
    role: String(role || ''),
    createdAt: nowMs,
    lastSeenAt: nowMs
  };

  if (req.session.cookie) {
    req.session.cookie.maxAge = Math.min(policy.idleTimeoutMs, policy.absoluteTimeoutMs);
  }
}

function sessionExpired(sessionPolicy, policy, nowMs) {
  const createdAt = Number(sessionPolicy.createdAt || nowMs);
  const lastSeenAt = Number(sessionPolicy.lastSeenAt || createdAt);

  return (
    nowMs - createdAt > policy.absoluteTimeoutMs ||
    nowMs - lastSeenAt > policy.idleTimeoutMs
  );
}

function clearExpiredSession(req, res) {
  const cookieName = process.env.SESSION_COOKIE_NAME || 'auth.sid';

  if (typeof res.clearCookie === 'function') {
    res.clearCookie(cookieName, { path: '/' });
  }

  if (!req.session || typeof req.session.destroy !== 'function') {
    return res.status(401).end();
  }

  return req.session.destroy(() => res.status(401).end());
}

function createSessionPolicyMiddleware({ nowProvider = Date.now } = {}) {
  return function sessionPolicyMiddleware(req, res, next) {
    if (!req.session || !req.user) {
      return next();
    }

    const role = req.user.role || req.user.roleCode || '';
    const nowMs = nowProvider();
    const policy = getRoleSessionPolicy(role);

    if (!req.session.authPolicy) {
      initializeSessionPolicy(req, role, nowMs);
      return next();
    }

    if (sessionExpired(req.session.authPolicy, policy, nowMs)) {
      return clearExpiredSession(req, res);
    }

    const createdAt = Number(req.session.authPolicy.createdAt || nowMs);
    const remainingAbsoluteMs = Math.max(policy.absoluteTimeoutMs - (nowMs - createdAt), 0);

    req.session.authPolicy = {
      ...req.session.authPolicy,
      role: String(role || ''),
      lastSeenAt: nowMs
    };

    if (req.session.cookie) {
      req.session.cookie.maxAge = Math.min(policy.idleTimeoutMs, remainingAbsoluteMs);
    }

    return next();
  };
}

export {
  ROLE_POLICIES,
  createSessionPolicyMiddleware,
  getDefaultAuthSessionMaxAgeMs,
  getDefaultAuthSessionTtlSeconds,
  getRoleSessionPolicy,
  initializeSessionPolicy
};
