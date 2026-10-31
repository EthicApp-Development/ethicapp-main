import { useEffect, useState } from 'react';
import { fetchPasswordPolicy } from '../api/authApi';
import { normalizePasswordPolicy } from '../utils/passwordPolicy';

// The password strength limits, or null while they load or when they could
// not be read. Forms then show no checklist and leave the decision to
// auth-backend, which refuses a weak password with its own message.
export function usePasswordPolicy() {
  const [policy, setPolicy] = useState(null);

  useEffect(() => {
    let isMounted = true;

    fetchPasswordPolicy()
      .then((result) => {
        if (isMounted) {
          setPolicy(normalizePasswordPolicy(result));
        }
      })
      .catch(() => {
        if (isMounted) {
          setPolicy(null);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return policy;
}
