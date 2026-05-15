import axios from 'axios';
import { authApiBaseUrl } from '../config/env';

const authApiClient = axios.create({
  baseURL: authApiBaseUrl,
  withCredentials: true
});

let csrfTokenPromise = null;

function isMutatingMethod(method = 'get') {
  return ['post', 'put', 'patch', 'delete'].includes(method.toLowerCase());
}

async function getCsrfToken() {
  if (!csrfTokenPromise) {
    csrfTokenPromise = authApiClient
      .get('/csrf-token')
      .then((response) => response.data.csrfToken)
      .catch((error) => {
        csrfTokenPromise = null;
        throw error;
      });
  }

  return csrfTokenPromise;
}

authApiClient.interceptors.request.use(async (config) => {
  if (isMutatingMethod(config.method)) {
    config.headers = config.headers || {};
    config.headers['X-CSRF-Token'] = await getCsrfToken();
  }

  return config;
});

export async function login(credentials) {
  const response = await authApiClient.post('/login', credentials);
  return response.data;
}

export async function register(payload) {
  const response = await authApiClient.post('/register', payload);
  return response.data;
}

export async function forgotPassword(payload) {
  const response = await authApiClient.post('/forgot', payload);
  return response.data;
}

export async function resetPassword(payload) {
  const response = await authApiClient.post('/reset-password', payload);
  return response.data;
}
