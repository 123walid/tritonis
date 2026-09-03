// JWT auth: login, middleware, password change.
// Secret from env JWT_SECRET; dev default below (documented in README — never for production).
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from './db.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'tritonis-dev-secret-change-me';
const TOKEN_TTL = '24h';

export function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function verifyToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(payload.sub);
    return user || null;
  } catch {
    return null;
  }
}

export function login(email, password) {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase());
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) return null;
  return user;
}

export function changePassword(userId, currentPassword, newPassword) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || !bcrypt.compareSync(String(currentPassword || ''), user.password_hash)) {
    return { ok: false, error: 'wrong_password' };
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return { ok: false, error: 'weak_password' };
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(newPassword, 10), userId);
  return { ok: true };
}

// Express middleware — all routes except POST /auth/login.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = token && verifyToken(token);
  if (!user) return res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid token' });
  req.user = user;
  next();
}
