import fs from 'node:fs';
import path from 'node:path';

const config = {
  studentApiBasePath: process.env.VITE_STUDENT_API_BASE_PATH || '',
  studentSocketUrl: process.env.VITE_STUDENT_SOCKET_URL || '',
  showDevMetadata: process.env.VITE_SHOW_DEV_METADATA || ''
};

const content = `window.__STUDENT_RUNTIME_CONFIG__ = ${JSON.stringify(config)};\n`;
const outputPath = process.env.STUDENT_RUNTIME_CONFIG_PATH || '/app/frontend/dist/runtime-config.js';
const outputDirectory = path.dirname(outputPath);

if (!process.env.STUDENT_RUNTIME_CONFIG_PATH && !fs.existsSync(outputDirectory)) {
  console.warn(`Student runtime config target does not exist; skipping ${outputPath}`);
  process.exit(0);
}

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(outputPath, content);
