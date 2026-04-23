import axios from 'axios';
import { studentApiBasePath } from '../config/env.js';

const studentApi = axios.create({
  baseURL: studentApiBasePath,
  withCredentials: true
});

export { studentApi };
