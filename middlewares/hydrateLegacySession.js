module.exports = function hydrateLegacySession(req, res, next) {
  try {
    const headerUserId = req.get('X-User-Id');
    const headerUserRole = req.get('X-User-Role');

    if (!headerUserId) {
      return next();
    }

    const incomingUid = Number(headerUserId);

    if (!Number.isInteger(incomingUid) || incomingUid <= 0) {
      return next();
    }

    if (req.session && req.session.uid === incomingUid) {
      if (!req.session.role && headerUserRole) {
        req.session.role = headerUserRole;
      }
      return next();
    }

    req.session.regenerate(function (err) {
      if (err) {
        return next(err);
      }

      req.session.uid = incomingUid;
      req.session.role = headerUserRole || null;

      return next();
    });
  } catch (error) {
    return next(error);
  }
};