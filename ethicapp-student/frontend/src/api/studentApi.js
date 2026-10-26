import axios from 'axios';
import { studentApiBasePath } from '../config/env.js';
import { installApiErrorInterceptors } from './apiInterceptors.js';
import { sessionExpiryFlow } from './sessionExpiry.js';

const handlers = {
  onExpired: (details) => sessionExpiryFlow.start(details)
};

const studentApi = installApiErrorInterceptors(
  axios.create({
    baseURL: studentApiBasePath,
    withCredentials: true
  }),
  handlers
);

const legacyUserApi = installApiErrorInterceptors(
  axios.create({
    withCredentials: true
  }),
  handlers
);

export { studentApi, legacyUserApi };
