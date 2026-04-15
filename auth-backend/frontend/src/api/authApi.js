import axios from 'axios';
import { authApiBaseUrl } from '../config/env';

const authApiClient = axios.create({
  baseURL: authApiBaseUrl,
  withCredentials: true
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
  const response = await authApiClient.post('/newpassword', payload);
  return response.data;
}
