export default function requireLegacyAuth(req, res, next) {
  if (req.session?.uid != null) {
    return next();
  }

  return res.redirect('/login');
}