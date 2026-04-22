export default function hydrateLegacySession(req, res, next) {
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

    if (!req.session.uid) {
      req.session.uid = incomingUid;
      req.session.role = incomingRole;
      req.session.authUid = incomingUid;
      req.session.authRole = incomingRole;
      req.session.impersonating = false;
      return next();
    }

    if (req.session.impersonating) {
      req.session.authUid = incomingUid;
      req.session.authRole = incomingRole;
      return next();
    }

    if (req.session.uid === incomingUid) {
      if (!req.session.role && incomingRole) {
        req.session.role = incomingRole;
      }
      req.session.authUid = incomingUid;
      req.session.authRole = incomingRole;
      return next();
    }

    req.session.regenerate((err) => {
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
}
