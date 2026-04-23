import axios from 'axios';
import { studentApiBasePath } from '../config/env.js';

const studentApi = axios.create({
  baseURL: studentApiBasePath,
  withCredentials: true
});

const legacyUserApi = axios.create({
  withCredentials: true
});

export { studentApi, legacyUserApi };
