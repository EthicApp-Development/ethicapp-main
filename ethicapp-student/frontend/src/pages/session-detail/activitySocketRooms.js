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
 * Joins the session's room and the student's room.
 *
 * @param {{ emit: Function }} socket
 * @param {object} options
 * @param {number} options.sessionId
 * @param {number} options.userId - Ignored by the server, which joins the
 *     signed-in student's own room; sent for older servers.
 * @param {() => void} [options.onUserRoomJoined] - Called once the server
 *     has joined the student's room.
 * @param {() => boolean} [options.isActive] - Whether the activity is still
 *     the open one; an acknowledgement that arrives after it closed is
 *     ignored.
 */
export function joinActivityRooms(socket, {
  sessionId,
  userId,
  onUserRoomJoined = () => {},
  isActive = () => true
}) {
  socket.emit('joinSession', sessionId);
  socket.emit('joinUser', userId, () => {
    if (isActive()) {
      onUserRoomJoined();
    }
  });
}
