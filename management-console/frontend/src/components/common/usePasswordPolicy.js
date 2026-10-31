import { useEffect, useState } from 'react';

import { fetchPasswordPolicy } from '../../api/userPasswordApi.js';
import { normalizePasswordPolicy } from './passwordPolicy.js';

// The password strength limits, or null while they load, when they could
// not be read, or while `enabled` is false (a closed dialog loads nothing).
// Without them no checklist is shown, and auth-backend's refusal tells the
// administrator what is missing.
export function usePasswordPolicy({ enabled = true, load = fetchPasswordPolicy } = {}) {
  const [policy, setPolicy] = useState(null);

  useEffect(() => {
    if (!enabled || policy) {
      return undefined;
    }

    let active = true;

    load()
      .then((result) => {
        if (active) {
          setPolicy(normalizePasswordPolicy(result));
        }
      })
      .catch(() => {
        // The checklist stays hidden; auth-backend still decides.
      });

    return () => {
      active = false;
    };
  }, [enabled, load, policy]);

  return policy;
}
