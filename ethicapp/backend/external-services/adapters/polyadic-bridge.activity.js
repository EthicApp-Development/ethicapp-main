// Participant activity forwarded to a running Polyadic room (epic #601,
// #657): `POST /rooms/{room}/sessions/active/activity`, the route of
// ethicapp-ai-additions#177 (`polyadic-agents/backend/app/room_activity.py`).
// Polyadic answers 202, 404 when no mediator runs for the room, and 422 for
// any key other than the four below, so the body never carries anything else.

import { COMPOSING_SERVICE_TTL_SECONDS, isComposingKind } from "../../helpers/composing-signal.js";

// Activity is only worth sending while it is fresh: a request that takes
// longer is abandoned instead of holding the handler for the client's
// default 12 s.
export const ROOM_ACTIVITY_TIMEOUT_MS = 3000;

export function roomActivityPath(roomName) {
    return `/rooms/${encodeURIComponent(roomName)}/sessions/active/activity`;
}

function isoTimeOf(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function participantIdOf(userId) {
    const id = Number(userId);
    return Number.isSafeInteger(id) && id > 0 ? String(id) : null;
}

/**
 * The body of the room-activity request for a `participant-activity`
 * context, or null when the context cannot make a valid one:
 *
 * - `kind`: `composing` or `stopped`, as received;
 * - `received_at`: the server's receipt time, ISO 8601 in UTC (`Z`);
 * - `ttl_seconds`: the context's `ttlSeconds`, COMPOSING_SERVICE_TTL_SECONDS
 *   when absent;
 * - `participant_id`: the writer's EthicApp user id as a decimal string, as
 *   the bridge sends it with messages.
 *
 * @param {{ kind: string, userId: number, receivedAt: string|number|Date,
 *     ttlSeconds?: number }} context
 * @returns {{ kind: string, received_at: string, ttl_seconds: number,
 *     participant_id: string } | null}
 */
export function buildRoomActivityBody(context) {
    const receivedAt = isoTimeOf(context?.receivedAt);
    const participantId = participantIdOf(context?.userId);
    if (!isComposingKind(context?.kind) || receivedAt === null || participantId === null) {
        return null;
    }

    return {
        kind:           context.kind,
        received_at:    receivedAt,
        ttl_seconds:    context.ttlSeconds ?? COMPOSING_SERVICE_TTL_SECONDS,
        participant_id: participantId,
    };
}

/**
 * Sends one activity signal to a room. Resolves to `"sent"`, to
 * `"not_running"` when Polyadic answers 404 because no mediator runs for the
 * room, or to `"invalid"` without a request when the context makes no valid
 * body. Rejects with the client's error otherwise, a timeout included.
 *
 * @param {(pathname: string, options: object) => Promise<unknown>} requestJson
 *     The bridge's Polyadic request function.
 * @param {string} roomName
 * @param {Object} context - A `participant-activity` context.
 * @returns {Promise<"sent"|"not_running"|"invalid">}
 */
export async function sendRoomActivity(requestJson, roomName, context) {
    const body = buildRoomActivityBody(context);
    if (!body) {
        return "invalid";
    }

    try {
        await requestJson(roomActivityPath(roomName), {
            method:    "POST",
            body,
            timeoutMs: ROOM_ACTIVITY_TIMEOUT_MS,
        });
    } catch (error) {
        if (Number(error?.statusCode) === 404) {
            return "not_running";
        }
        throw error;
    }
    return "sent";
}
