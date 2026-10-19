import { Router } from 'express';
import { query as defaultQuery } from '../config/database.js';
import { getDomainEventPublisher } from '../services/domain-events/index.js';
import {
  JOIN_OUTCOMES,
  joinSessionByCode,
  normalizeDevice,
  normalizeSessionCode
} from '../services/session-join.service.js';
import { ensureStudentSession, t } from './student-route-helpers.js';

const OUTCOME_RESPONSES = {
  [JOIN_OUTCOMES.JOINED]: { status: 201 },
  [JOIN_OUTCOMES.ALREADY_JOINED]: { status: 200 },
  [JOIN_OUTCOMES.CODE_NOT_FOUND]: { status: 404, messageKey: 'sessionCodeNotFound' },
  [JOIN_OUTCOMES.JOINING_CLOSED]: { status: 409, messageKey: 'sessionJoiningClosed' }
};

/**
 * POST /sessions/join — authoritative session join for students.
 * Dependencies are injectable for tests; the publisher is resolved per request
 * so importing this module never opens a Redis connection.
 */
export function createSessionJoinRouter({
  joinSession = joinSessionByCode,
  query = defaultQuery,
  getPublisher = getDomainEventPublisher,
  logger = console
} = {}) {
  const router = Router();

  router.post('/sessions/join', async (req, res, next) => {
    const uid = ensureStudentSession(req, res);

    if (!uid) {
      return;
    }

    const code = normalizeSessionCode(req.body?.code);
    if (!code) {
      return res.status(400).json({ status: 'invalid_request', error: t(req, 'sessionCodeRequired') });
    }

    const { valid: deviceIsValid, device } = normalizeDevice(req.body?.device);
    if (!deviceIsValid) {
      return res.status(400).json({ status: 'invalid_request', error: t(req, 'invalidDevice') });
    }

    try {
      const { outcome, sessionId } = await joinSession({
        uid,
        code,
        device,
        query,
        publisher: getPublisher(),
        logger
      });

      const { status, messageKey } = OUTCOME_RESPONSES[outcome];
      const body = messageKey
        ? { status: outcome, error: t(req, messageKey) }
        : { status: outcome, sesid: sessionId };

      return res.status(status).json(body);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
