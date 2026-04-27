export default function hydrateSessionFromAuthProxy(req, res, next) {
  const headerUserId = req.get('X-User-Id');
  const headerUserRole = req.get('X-User-Role');

  if (!req.session || !headerUserId) {
    return next();
  }

  const incomingUserId = Number(headerUserId);

  if (!Number.isInteger(incomingUserId) || incomingUserId <= 0) {
    return next();
  }

  req.session.uid = incomingUserId;
  req.session.role = String(headerUserRole || '');

  return next();
}
