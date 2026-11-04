import { useEffect, useState } from 'react';
import { fetchSession } from '../api/authApi';

// Whether the sign-in page should show its form: 'checking' while the
// session is asked for, 'redirecting' once a signed-in user is being sent to
// their role's home, and 'anonymous' otherwise. Any failure of the check (a
// network error, a timeout, or the 401 of a session the policy ended) counts
// as anonymous, so the form is never withheld. With enabled false, nothing
// is asked and the form shows at once.
export function useSessionRedirect({ enabled = true } = {}) {
  const [status, setStatus] = useState(enabled ? 'checking' : 'anonymous');

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let isMounted = true;

    fetchSession()
      .then((session) => {
        if (!isMounted) {
          return;
        }

        const redirectTo = typeof session?.redirectTo === 'string' ? session.redirectTo : '';

        if (session?.authenticated === true && redirectTo.startsWith('/') && !redirectTo.startsWith('//')) {
          setStatus('redirecting');
          window.location.replace(redirectTo);
          return;
        }

        setStatus('anonymous');
      })
      .catch(() => {
        if (isMounted) {
          setStatus('anonymous');
        }
      });

    return () => {
      isMounted = false;
    };
  }, [enabled]);

  return status;
}
