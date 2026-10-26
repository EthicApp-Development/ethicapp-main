import { randomUUID } from 'node:crypto';

// Domain-event envelope shared by EthicApp services over the application Redis.
// Canonical contract: canonical-schemas/events/domain-event-envelope-v1.schema.json.
// ethicapp/backend/services/domain-events/domain-event-envelope.js mirrors these
// rules for the consuming side; keep both aligned with the schema.

export const DOMAIN_EVENT_CHANNEL_PREFIX = 'ethicapp:events:';
export const DOMAIN_EVENT_SOURCE = 'ethicapp-student';

const KEBAB_CASE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MAX_DEVICE_LENGTH = 64;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function rejectUnknownFields(payload, allowedFields) {
  return Object.keys(payload)
    .filter((key) => !allowedFields.includes(key))
    .map((key) => `Unknown payload field: ${key}.`);
}

// Payload validators for the events this service publishes, keyed by type@version.
// Canonical contracts live next to the envelope schema in canonical-schemas/events/.
const PAYLOAD_VALIDATORS = {
  'session-participant-joined@1': (payload) => {
    const errors = rejectUnknownFields(payload, ['sessionId', 'userId', 'device']);

    if (!isPositiveInteger(payload.sessionId)) {
      errors.push('sessionId must be a positive integer.');
    }

    if (!isPositiveInteger(payload.userId)) {
      errors.push('userId must be a positive integer.');
    }

    const { device } = payload;
    if (device !== null && (typeof device !== 'string' || device.length > MAX_DEVICE_LENGTH)) {
      errors.push(`device must be null or a string of at most ${MAX_DEVICE_LENGTH} characters.`);
    }

    return errors;
  }
};

export function getDomainEventChannel(type) {
  if (typeof type !== 'string' || !KEBAB_CASE_PATTERN.test(type)) {
    throw new Error(`Invalid domain event type: ${type}`);
  }

  return `${DOMAIN_EVENT_CHANNEL_PREFIX}${type}`;
}

/**
 * Builds a domain-event envelope for a known event type and version.
 * @returns {{ event: object | null, errors: string[] }}
 */
export function createDomainEvent({
  type,
  version,
  payload,
  source = DOMAIN_EVENT_SOURCE,
  now = () => new Date(),
  generateId = randomUUID
}) {
  const validatePayload = PAYLOAD_VALIDATORS[`${type}@${version}`];

  if (!validatePayload) {
    return { event: null, errors: [`Unknown domain event ${type} v${version}.`] };
  }

  if (!isPlainObject(payload)) {
    return { event: null, errors: ['payload must be an object.'] };
  }

  const errors = validatePayload(payload);
  if (errors.length > 0) {
    return { event: null, errors };
  }

  return {
    event: {
      type,
      version,
      id: generateId(),
      occurredAt: now().toISOString(),
      source,
      payload
    },
    errors
  };
}
