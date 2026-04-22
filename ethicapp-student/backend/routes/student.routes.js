import { Router } from 'express';

const router = Router();

router.get('/session', (req, res) => {
  res.json({
    uid: req.session?.uid ?? null,
    role: req.session?.role ?? null,
    isAuthenticated: req.session?.uid != null,
    impersonating: !!req.session?.impersonating
  });
});

export default router;
