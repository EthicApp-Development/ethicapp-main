import { createBrowserRouter, Navigate } from 'react-router-dom';

import LoginPage from '../pages/LoginPage';
import RegisterPage from '../pages/RegisterPage';
import ForgotPasswordPage from '../pages/ForgotPasswordPage';
import ResetPasswordPage from '../pages/ResetPasswordPage';
import LogoutPage from '../pages/LogoutPage';

import NotFoundPage from '../pages/NotFoundPage';
import PrivacyPolicyPage from '../pages/PrivacyPolicyPage';
import TermsOfUsePage from '../pages/TermsOfUsePage';

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
    element: <LogoutPage />
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
    path: '/terms',
    element: <TermsOfUsePage />
  },  
  {
    path: '*',
    element: <NotFoundPage />
  }
],
{
  basename: '/auth'
});

export default router;
