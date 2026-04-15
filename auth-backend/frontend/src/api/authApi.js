import axios from 'axios';

export async function login(credentials) {
  const response = await axios.post('/api/auth/login', credentials, {
    withCredentials: true
  });

  return response.data;
}

export async function register(payload) {
  const response = await axios.post('/api/auth/register', payload, {
    withCredentials: true
  });

  return response.data;
}

export async function forgotPassword(payload) {
  const response = await axios.post('/api/auth/forgot', payload, {
    withCredentials: true
  });

  return response.data;
}

export async function resetPassword(payload) {
  const response = await axios.post('/api/auth/newpassword', payload, {
    withCredentials: true
  });

  return response.data;
}