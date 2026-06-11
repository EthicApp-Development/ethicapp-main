import { useEffect, useState } from 'react';
import { fetchInstitution } from '../api/authApi';

const EMPTY_METADATA = {
  name: '',
  privacyContact: ''
};

export function useInstitutionMetadata() {
  const [metadata, setMetadata] = useState(EMPTY_METADATA);

  useEffect(() => {
    let isMounted = true;

    fetchInstitution()
      .then((institution) => {
        if (!isMounted) {
          return;
        }

        setMetadata({
          name: String(institution?.name || '').trim(),
          privacyContact: String(institution?.privacyContact || '').trim()
        });
      })
      .catch(() => {
        if (isMounted) {
          setMetadata(EMPTY_METADATA);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return metadata;
}
