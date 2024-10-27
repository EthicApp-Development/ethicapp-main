#!/usr/bin/env node
import crypto from 'crypto';
import fs from 'fs';

const generateKeyAndIV = () => {
  const key = crypto.randomBytes(32).toString('hex');  // 256-bit key for AES-256
  const iv = crypto.randomBytes(16).toString('hex');   // 128-bit IV

  // Add key and IV to .env file
  fs.writeFileSync('.env', `CREDENTIALS_SECRET_KEY=${key}\nCREDENTIALS_IV=${iv}\n`, { flag: 'a' });
  console.log('SECRET_KEY and IV generated and kept in .env');
};

generateKeyAndIV();

