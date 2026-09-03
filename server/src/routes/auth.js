// POST /auth/login, POST /auth/logout, POST /auth/password
import { Router } from 'express';
import { login, signToken, changePassword, requireAuth } from '../auth.js';

const router = Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = login(String(email || '').toLowerCase(), password);
  if (!user) return res.status(401).json({ error: 'invalid_credentials', message: 'Wrong email or password' });
  res.json({ token: signToken(user), user: { id: user.id, email: user.email } });
});

router.post('/logout', requireAuth, (_req, res) => {
  // Stateless JWT: nothing to revoke server-side (phase 1).
  res.status(204).end();
});

router.post('/password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (typeof new_password !== 'string' || new_password.length < 8) {
    return res.status(400).json({ error: 'weak_password', message: 'Use at least 8 characters' });
  }
  const result = changePassword(req.user.id, current_password, new_password);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.status(204).end();
});

export default router;
