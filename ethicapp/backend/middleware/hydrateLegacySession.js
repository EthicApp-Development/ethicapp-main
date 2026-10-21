export default function hydrateLegacySession(req, res, next) {
  try {
    const headerUserId = req.get("X-User-Id");
    const headerUserRole = req.get("X-User-Role");

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

    // Impersonation belongs to the super-admin who started it: keep the
    // effective uid/role only while that same user arrives. Anyone else
    // (e.g. a sign-out followed by another sign-in) gets a fresh session.
    if (req.session.impersonating) {
      if (Number(req.session.authUid) === incomingUid && incomingRole === "S") {
        return next();
      }

      return regenerateFor(req, incomingUid, incomingRole, next);
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
    return regenerateFor(req, incomingUid, incomingRole, next);
  } catch (error) {
    return next(error);
  }
}

function regenerateFor(req, incomingUid, incomingRole, next) {
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
}
