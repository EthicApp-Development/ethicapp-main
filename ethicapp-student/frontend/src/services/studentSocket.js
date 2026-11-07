import { studentSocketUrl } from '../config/env.js';

let socketInstance = null;
let socketScriptPromise = null;

function loadSocketIoClientScript() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Socket.IO client is only available in browser environments.'));
  }

  if (window.io) {
    return Promise.resolve(window.io);
  }

  if (socketScriptPromise) {
    return socketScriptPromise;
  }

  socketScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[data-student-socket-io-client="true"]');

    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.io));
      existingScript.addEventListener('error', () =>
        reject(new Error('Failed to load Socket.IO client script.'))
      );
      return;
    }

    const script = document.createElement('script');
    script.src = `${studentSocketUrl}/socket.io/socket.io.js`;
    script.async = true;
    script.dataset.studentSocketIoClient = 'true';
    script.onload = () => resolve(window.io);
    script.onerror = () => reject(new Error('Failed to load Socket.IO client script.'));
    document.head.appendChild(script);
  });

  return socketScriptPromise;
}

export async function getStudentSocket() {
  if (socketInstance) {
    return socketInstance;
  }

  const ioClient = await loadSocketIoClientScript();

  socketInstance = ioClient(`${studentSocketUrl}/student`, {
    withCredentials: true,
    transports: ['websocket', 'polling'],
    // Retries never stop, but slow down to one every 30 s at most (±50%), so
    // a class whose handshakes are refused (an expired session, a blocked
    // cookie in an LMS iframe) does not hammer the edge. Meanwhile the
    // activity view polls its state (#626).
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    randomizationFactor: 0.5
  });

  return socketInstance;
}
