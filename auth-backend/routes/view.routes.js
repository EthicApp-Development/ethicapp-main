import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const spaIndexPath = path.join(__dirname, '..', 'public', 'app', 'index.html');

router.get('/', (req, res) => {
  res.sendFile(spaIndexPath);
});

router.get('/login', (req, res) => {
  res.sendFile(spaIndexPath);
});

router.get('/register', (req, res) => {
  res.sendFile(spaIndexPath);
});

router.get('/forgot', (req, res) => {
  res.sendFile(spaIndexPath);
});

router.get('/reset-password', (req, res) => {
  res.sendFile(spaIndexPath);
});

export default router;
