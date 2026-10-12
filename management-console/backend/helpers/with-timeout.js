function createCodedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createTimeoutError(message = 'Operation timed out') {
  return createCodedError(message, 'ETIMEOUT');
}

export function createDeadlineError() {
  return createCodedError('Overall check deadline exceeded', 'EDEADLINE');
}

// Rejects with ETIMEOUT after `timeoutMs`, or with EDEADLINE as soon as
// `signal` aborts. The wrapped promise keeps running; callers that own
// cancellable resources must release them separately.
export function withTimeout(promise, timeoutMs, { signal } = {}) {
  let timer;
  let onAbort;
  const bound = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(createTimeoutError()), timeoutMs);

    if (signal) {
      onAbort = () => reject(createDeadlineError());

      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }
  });

  return Promise.race([promise, bound]).finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  });
}
