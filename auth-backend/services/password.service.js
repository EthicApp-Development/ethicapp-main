import bcrypt from 'bcrypt';
import crypto from 'node:crypto';

const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 10);

async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(password, passwordHash) {
  if (!password || !passwordHash) {
    return false;
  }

  return bcrypt.compare(password, passwordHash);
}

function generateResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

export {
  hashPassword,
  verifyPassword,
  generateResetToken
};
