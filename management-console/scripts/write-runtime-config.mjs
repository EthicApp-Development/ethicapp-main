import fs from 'node:fs';
import path from 'node:path';

const config = {
  recaptchaSiteKey: process.env.VITE_RECAPTCHA_SITE_KEY || ''
};

const content = `window.__MNG_RUNTIME_CONFIG__ = ${JSON.stringify(config)};\n`;
const outputPath = process.env.MNG_RUNTIME_CONFIG_PATH || '/app/frontend/dist/runtime-config.js';
const outputDirectory = path.dirname(outputPath);

if (!process.env.MNG_RUNTIME_CONFIG_PATH && !fs.existsSync(outputDirectory)) {
  console.warn(`Management console runtime config target does not exist; skipping ${outputPath}`);
  process.exit(0);
}

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(outputPath, content);
