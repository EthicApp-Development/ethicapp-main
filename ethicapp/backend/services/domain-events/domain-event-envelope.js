// Domain-event envelope shared by EthicApp services over the application Redis.
// Canonical contract: canonical-schemas/events/domain-event-envelope-v1.schema.json.
// ethicapp-student/backend/services/domain-events/domain-event-envelope.js mirrors
// these rules for the publishing side; keep both aligned with the schema.

export const DOMAIN_EVENT_CHANNEL_PREFIX = "ethicapp:events:";

const ENVELOPE_FIELDS = new Set(["type", "version", "id", "occurredAt", "source", "payload"]);
const KEBAB_CASE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_TIME_PATTERN =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isValidEventType(type) {
    return typeof type === "string" && KEBAB_CASE_PATTERN.test(type);
}

/**
 * Returns the Redis pub/sub channel for an event type.
 * @param {string} type Kebab-case event type.
 * @returns {string} Channel name.
 */
export function getDomainEventChannel(type) {
    if (!isValidEventType(type)) {
        throw new Error(`Invalid domain event type: ${type}`);
    }

    return `${DOMAIN_EVENT_CHANNEL_PREFIX}${type}`;
}

/**
 * Validates a domain-event envelope.
 * @param {unknown} event Candidate envelope.
 * @returns {string[]} Validation errors; empty when the envelope is valid.
 */
export function validateDomainEvent(event) {
    if (!isPlainObject(event)) {
        return ["Event must be an object."];
    }

    const errors = [];

    for (const key of Object.keys(event)) {
        if (!ENVELOPE_FIELDS.has(key)) {
            errors.push(`Unknown envelope field: ${key}.`);
        }
    }

    if (!isValidEventType(event.type)) {
        errors.push("type must be a kebab-case string.");
    }

    if (!Number.isInteger(event.version) || event.version < 1) {
        errors.push("version must be a positive integer.");
    }

    if (typeof event.id !== "string" || !UUID_PATTERN.test(event.id)) {
        errors.push("id must be a UUID.");
    }

    if (
        typeof event.occurredAt !== "string" ||
        !ISO_DATE_TIME_PATTERN.test(event.occurredAt) ||
        Number.isNaN(Date.parse(event.occurredAt))
    ) {
        errors.push("occurredAt must be an ISO 8601 date-time.");
    }

    if (!isValidEventType(event.source)) {
        errors.push("source must be a kebab-case service name.");
    }

    if (!isPlainObject(event.payload)) {
        errors.push("payload must be an object.");
    }

    return errors;
}

/**
 * Parses and validates a raw pub/sub message.
 * @param {string} message Raw message.
 * @returns {{ event: object | null, errors: string[] }} Parsed event or errors.
 */
export function parseDomainEventMessage(message) {
    let event;

    try {
        event = JSON.parse(message);
    } catch {
        return { event: null, errors: ["Message is not valid JSON."] };
    }

    const errors = validateDomainEvent(event);
    return errors.length > 0 ? { event: null, errors } : { event, errors };
}
