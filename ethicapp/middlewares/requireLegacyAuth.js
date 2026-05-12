module.exports = function requireLegacyAuth(req, res, next) {
  if (req.session && req.session.uid) {
    return next();
  }

  return res.redirect('/auth/login');
};
