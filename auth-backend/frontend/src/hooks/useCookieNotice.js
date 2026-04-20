import { useEffect, useState } from 'react';

const COOKIE_NOTICE_KEY = 'ethicapp_cookie_notice_ack';

export default function useCookieNotice() {
  const [isOpen, setIsOpen] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    try {
      const storedValue = window.localStorage.getItem(COOKIE_NOTICE_KEY);
      setIsOpen(storedValue !== 'true');
    } catch (error) {
      setIsOpen(true);
    } finally {
      setIsReady(true);
    }
  }, []);

  function acceptNotice() {
    try {
      window.localStorage.setItem(COOKIE_NOTICE_KEY, 'true');
    } catch (error) {
      // Ignore storage errors and still close the overlay.
    }

    setIsOpen(false);
  }

  function resetNotice() {
    try {
      window.localStorage.removeItem(COOKIE_NOTICE_KEY);
    } catch (error) {
      // Ignore storage errors.
    }

    setIsOpen(true);
  }

  return {
    isOpen,
    isReady,
    acceptNotice,
    resetNotice
  };
}