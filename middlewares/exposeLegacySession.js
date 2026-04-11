module.exports = function exposeLegacySession(req, res, next) {
  const session = req.session || {};

  res.locals.uid = session.uid || null;
  res.locals.role = session.role || null;
  res.locals.sesid = session.sesid || null;
  res.locals.isAuthenticated = !!session.uid;

  next();
};