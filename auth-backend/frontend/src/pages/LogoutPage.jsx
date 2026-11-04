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

  // The form shows while the session is ended; asking whether a session
  // exists now would send the user home before it is gone. The login page
  // this replaces itself with asks once the logout has completed.
  return <LoginPage checkSession={false} />;
}

export default LogoutPage;
