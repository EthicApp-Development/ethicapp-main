import axios from 'axios';

const api = axios.create({
  withCredentials: true
});

export async function login(payload) {
  const { data } = await api.post('/login', payload);
  return data;
}

export async function register(payload) {
  const { data } = await api.post('/register', payload);
  return data;
}

export async function forgotPassword(payload) {
  const { data } = await api.post('/forgot', payload);
  return data;
}

export async function resetPassword(payload) {
  const { data } = await api.post('/reset-password', payload);
  return data;
}

export default api;