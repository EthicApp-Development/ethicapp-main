module.exports = function hydrateLegacySession(req, res, next) {
  try {
    const headerUserId = req.get('X-User-Id');
    const headerUserRole = req.get('X-User-Role');

    if (!headerUserId || !req.session) {
      return next();
    }

    const incomingUid = Number(headerUserId);

    if (!Number.isInteger(incomingUid) || incomingUid <= 0) {
      return next();
    }

    const incomingRole = headerUserRole || null;

    // First hydration: no local session user yet
    if (!req.session.uid) {
      req.session.uid = incomingUid;
      req.session.role = incomingRole;
      req.session.authUid = incomingUid;
      req.session.authRole = incomingRole;
      req.session.impersonating = false;
      return next();
    }

    // If impersonation is active, keep effective uid/role untouched,
    // but refresh canonical auth identity from headers.
    if (req.session.impersonating) {
      req.session.authUid = incomingUid;
      req.session.authRole = incomingRole;
      return next();
    }

    // Normal case: keep session aligned with canonical auth identity
    if (req.session.uid === incomingUid) {
      if (incomingRole && req.session.role !== incomingRole) {
        req.session.role = incomingRole;
      }
      req.session.authUid = incomingUid;
      req.session.authRole = incomingRole;
      return next();
    }

    // Canonical identity changed (e.g. real logout/login as another user)
    req.session.regenerate(function (err) {
      if (err) {
        return next(err);
      }

      req.session.uid = incomingUid;
      req.session.role = incomingRole;
      req.session.authUid = incomingUid;
      req.session.authRole = incomingRole;
      req.session.impersonating = false;

      return next();
    });
  } catch (error) {
    return next(error);
  }
};
