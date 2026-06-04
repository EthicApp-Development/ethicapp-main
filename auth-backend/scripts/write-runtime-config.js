import fs from 'node:fs';
import path from 'node:path';

const config = {
  authPublicUrl: process.env.VITE_AUTH_PUBLIC_URL || '',
  authApiBaseUrl: process.env.VITE_AUTH_API_BASE_URL || '',
  recaptchaProvider: process.env.RECAPTCHA_PROVIDER || '',
  recaptchaSiteKey: process.env.VITE_RECAPTCHA_SITE_KEY || ''
};

const content = `window.__AUTH_RUNTIME_CONFIG__ = ${JSON.stringify(config)};\n`;
const outputPath = process.env.AUTH_RUNTIME_CONFIG_PATH || '/app/public/app/runtime-config.js';
const outputDirectory = path.dirname(outputPath);

if (!process.env.AUTH_RUNTIME_CONFIG_PATH && !fs.existsSync(outputDirectory)) {
  console.warn(`Auth runtime config target does not exist; skipping ${outputPath}`);
  process.exit(0);
}

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(outputPath, content);
