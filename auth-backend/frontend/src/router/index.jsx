import { createBrowserRouter, Navigate } from 'react-router-dom';

import LoginPage from '../pages/LoginPage';
import RegisterPage from '../pages/RegisterPage';
import ForgotPasswordPage from '../pages/ForgotPasswordPage';
import ResetPasswordPage from '../pages/ResetPasswordPage';

import NotFoundPage from '../pages/NotFoundPage';
import PrivacyPolicyPage from '../pages/PrivacyPolicyPage';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/login" replace />
  },
  {
    path: '/login',
    element: <LoginPage />
  },
  {
    path: '/logout',
    element: <LoginPage />
  },  
  {
    path: '/register',
    element: <RegisterPage />
  },
  {
    path: '/forgot',
    element: <ForgotPasswordPage />
  },
  {
    path: '/reset-password',
    element: <ResetPasswordPage />
  },
  {
    path: '/privacy',
    element: <PrivacyPolicyPage />
  },
  {
    path: '*',
    element: <NotFoundPage />
  }
]);

export default router;