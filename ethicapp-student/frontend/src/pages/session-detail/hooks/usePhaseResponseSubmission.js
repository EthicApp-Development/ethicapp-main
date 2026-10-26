import { useState } from 'react';

const RESPONSE_COOLDOWN_MS = 3000;

export function usePhaseResponseSubmission({
  t,
  selectedSessionId,
  submitActivityResponse,
  loadFullState,
  userId,
  onResponseAccepted
}) {
  const [lastSubmittedAtByResponse, setLastSubmittedAtByResponse] = useState({});

  const onSubmitPhaseResponse = async ({ responseKey, responsePayload }) => {
    if (!responsePayload || typeof responsePayload !== 'object') {
      return { ok: false, message: t('sessionDetail.responseSubmitError') };
    }

    const now = Date.now();
    const key = String(responseKey ?? responsePayload?.questionId ?? 'response');
    const lastSubmittedAt = lastSubmittedAtByResponse[key] ?? 0;

    if (now - lastSubmittedAt < RESPONSE_COOLDOWN_MS) {
      const cooldownSeconds = Math.ceil((RESPONSE_COOLDOWN_MS - (now - lastSubmittedAt)) / 1000);
      return { ok: false, message: `${t('sessionDetail.responseCooldown')} ${cooldownSeconds}s.` };
    }

    if (!selectedSessionId || Number.isNaN(selectedSessionId)) {
      return { ok: false, message: t('sessionDetail.responseSubmitError') };
    }

    try {
      await submitActivityResponse({ sessionId: selectedSessionId, responsePayload });
      setLastSubmittedAtByResponse((prev) => ({ ...prev, [key]: now }));
      onResponseAccepted?.({
        responseKey: key,
        responsePayload
      });
      await loadFullState({ sessionId: selectedSessionId, userId, invalidate: true });
      return { ok: true, message: t('sessionDetail.responseSubmitted') };
    } catch {
      return { ok: false, message: t('sessionDetail.responseSubmitError') };
    }
  };

  return { onSubmitPhaseResponse };
}
