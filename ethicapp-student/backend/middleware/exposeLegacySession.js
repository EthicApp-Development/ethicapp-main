export default function exposeLegacySession(req, res, next) {
  const currentSession = req.session || {};

  res.locals.uid = currentSession.uid ?? null;
  res.locals.role = currentSession.role ?? null;
  res.locals.sesid = currentSession.sesid ?? null;
  res.locals.isAuthenticated = currentSession.uid != null;
  res.locals.impersonating = !!currentSession.impersonating;
  res.locals.authUid = currentSession.authUid ?? null;
  res.locals.authRole = currentSession.authRole ?? null;

  next();
}
