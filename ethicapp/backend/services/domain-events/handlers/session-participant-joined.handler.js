// Consumer of session-participant-joined v1.
// Canonical contract: canonical-schemas/events/session-participant-joined-v1.schema.json.

export const SESSION_PARTICIPANT_JOINED_TYPE = "session-participant-joined";
export const SESSION_PARTICIPANT_JOINED_VERSION = 1;

const PAYLOAD_FIELDS = new Set(["sessionId", "userId", "device"]);
const MAX_DEVICE_LENGTH = 64;

function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
}

/**
 * Validates a session-participant-joined v1 payload.
 * @param {object} payload Event payload.
 * @returns {string[]} Validation errors; empty when the payload is valid.
 */
export function validateSessionParticipantJoinedPayload(payload) {
    const errors = [];

    for (const key of Object.keys(payload)) {
        if (!PAYLOAD_FIELDS.has(key)) {
            errors.push(`Unknown payload field: ${key}.`);
        }
    }

    if (!isPositiveInteger(payload.sessionId)) {
        errors.push("sessionId must be a positive integer.");
    }

    if (!isPositiveInteger(payload.userId)) {
        errors.push("userId must be a positive integer.");
    }

    const { device } = payload;
    if (device !== null && (typeof device !== "string" || device.length > MAX_DEVICE_LENGTH)) {
        errors.push(`device must be null or a string of at most ${MAX_DEVICE_LENGTH} chars.`);
    }

    return errors;
}

/**
 * Relays a student join to the teacher Socket.IO namespace with the same
 * payload the legacy join endpoint emitted.
 * @param {object} dependencies
 * @param {(userId: number) => Promise<{ name, role, mail } | null>} dependencies.loadParticipant
 * @param {(sessionId: number, participant: object) => void} dependencies.notifyTeachers
 * @param {Console} [dependencies.logger]
 */
export function createSessionParticipantJoinedHandler({
    loadParticipant,
    notifyTeachers,
    logger = console,
}) {
    return {
        type:    SESSION_PARTICIPANT_JOINED_TYPE,
        version: SESSION_PARTICIPANT_JOINED_VERSION,

        async handle(event) {
            const errors = validateSessionParticipantJoinedPayload(event.payload);
            if (errors.length > 0) {
                logger.warn(
                    `[domain-events] Ignoring invalid payload in event ${event.id}: ` +
                    errors.join(" "),
                );
                return;
            }

            const { sessionId, userId, device } = event.payload;
            const participant = await loadParticipant(userId);

            if (!participant) {
                logger.warn(
                    `[domain-events] User ${userId} from event ${event.id} not found; ` +
                    "skipping teacher notification.",
                );
                return;
            }

            notifyTeachers(sessionId, {
                id:   userId,
                name: participant.name,
                device,
                role: participant.role,
                mail: participant.mail,
            });
        },
    };
}
