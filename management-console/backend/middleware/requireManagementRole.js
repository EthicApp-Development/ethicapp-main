export default function requireManagementRole(req, res, next) {
  if (!req.session?.uid) {
    return res.redirect('/auth/login');
  }

  if (req.session.role !== 'S') {
    return res.status(403).json({
      error: 'Forbidden'
    });
  }

  return next();
}
