export default function exposeLegacySession(req, res, next) {
  const session = req.session || {};

  res.locals.uid = session.uid ?? null;
  res.locals.role = session.role ?? null;
  res.locals.sesid = session.sesid ?? null;
  res.locals.isAuthenticated = session.uid != null;
  res.locals.impersonating = !!session.impersonating;
  res.locals.authUid = session.authUid ?? null;
  res.locals.authRole = session.authRole ?? null;

  next();
}