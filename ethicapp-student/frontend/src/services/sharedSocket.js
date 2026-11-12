/**
 * One Socket.IO socket shared by every caller of a page.
 *
 * The first call loads the client and opens the socket; every later call,
 * including one made while that first call is still loading the client,
 * receives the same promise and so the same socket. Opening a second socket
 * for a namespace already in use makes the Socket.IO client open a second
 * connection, and the rooms one hook joined on one socket would not deliver
 * the events another hook listens for on the other.
 *
 * A failed load is kept: later calls receive the same rejection.
 *
 * @template Socket
 * @param {object} options
 * @param {() => Promise<Function>} options.loadClient - Resolves to the
 *     Socket.IO client's `io` function.
 * @param {(io: Function) => Socket} options.connect - Opens the socket.
 * @returns {() => Promise<Socket>}
 */
export function createSharedSocket({ loadClient, connect }) {
  let socketPromise = null;

  return function getSocket() {
    socketPromise ??= Promise.resolve().then(loadClient).then(connect);
    return socketPromise;
  };
}
