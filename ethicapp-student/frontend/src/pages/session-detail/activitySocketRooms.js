/**
 * The Socket.IO rooms the student app joins for an activity: the session's
 * room, for phase changes, shared responses and the end of the activity, and
 * the student's own room, for the external-service results published to
 * them (#1128).
 *
 * The server acknowledges the student's room once it has joined it, so a
 * results load started from that acknowledgement misses nothing published to
 * the room: every result is either in its answer or reaches the socket as an
 * event (#1143). A join emitted before the socket's first connection is
 * buffered by Socket.IO and sent when it connects, so the acknowledgement
 * also comes after a delayed or initially failing first connection.
 */

/**
 * The rooms an activity view joins, as `[event, argument]` emits, in order:
 * the session's room, the student's room and, when the student has a group in
 * the current phase, the group's room (#1108).
 *
 * @param {object} options
 * @param {number} options.sessionId
 * @param {number} options.userId
 * @param {number|null} [options.groupId]
 * @returns {Array<[string, number]>}
 */
export function activityRoomJoins({ sessionId, userId, groupId = null }) {
  const joins = [['joinSession', sessionId], ['joinUser', userId]];
  const group = Number(groupId);
  if (Number.isInteger(group) && group > 0) {
    joins.push(['joinGroup', group]);
  }
  return joins;
}

/**
 * Joins the activity's rooms (activityRoomJoins()). The view calls it when it
 * opens and again after every reconnect: the server forgets a connection's
 * rooms when it drops, so a socket that reconnected without joining them
 * again would stay connected and receive nothing (#1108).
 *
 * @param {{ emit: Function }} socket
 * @param {object} options
 * @param {number} options.sessionId
 * @param {number} options.userId - Ignored by the server, which joins the
 *     signed-in student's own room; sent for older servers.
 * @param {number|null} [options.groupId] - The student's group in the
 *     current phase, if any.
 * @param {() => void} [options.onUserRoomJoined] - Called once the server
 *     has joined the student's room.
 * @param {() => boolean} [options.isActive] - Whether the activity is still
 *     the open one; an acknowledgement that arrives after it closed is
 *     ignored.
 */
export function joinActivityRooms(socket, {
  sessionId,
  userId,
  groupId = null,
  onUserRoomJoined = () => {},
  isActive = () => true
}) {
  for (const [event, argument] of activityRoomJoins({ sessionId, userId, groupId })) {
    if (event === 'joinUser') {
      socket.emit(event, argument, () => {
        if (isActive()) {
          onUserRoomJoined();
        }
      });
    } else {
      socket.emit(event, argument);
    }
  }
}
