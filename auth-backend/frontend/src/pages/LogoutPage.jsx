import { useEffect } from 'react';

import { logout } from '../api/authApi';
import LoginPage from './LoginPage';

function LogoutPage() {
  useEffect(() => {
    let active = true;

    async function endSession() {
      try {
        await logout();
      } catch (error) {
        console.error('Unable to complete logout:', error);
      } finally {
        if (active) {
          window.location.replace('/auth/login');
        }
      }
    }

    endSession();

    return () => {
      active = false;
    };
  }, []);

  return <LoginPage />;
}

export default LogoutPage;
