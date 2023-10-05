import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:5050',
});

export const getItems = () => {
  return api.get('/report');
};