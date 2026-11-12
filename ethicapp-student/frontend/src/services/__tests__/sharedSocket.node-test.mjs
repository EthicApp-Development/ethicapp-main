// One socket per page. The activity view's hooks ask for the student socket
// in the same render, before the Socket.IO client script has loaded; each of
// them used to open its own socket, so the rooms joined on one never
// delivered the events another listened for.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSharedSocket } from '../sharedSocket.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeClient() {
  const opened = [];
  const io = (url, options) => {
    const socket = { url, options, id: opened.length + 1 };
    opened.push(socket);
    return socket;
  };
  return { io, opened };
}

test('calls made while the client loads share one socket', async () => {
  const script = deferred();
  const client = fakeClient();
  let loads = 0;
  const getSocket = createSharedSocket({
    loadClient: () => {
      loads += 1;
      return script.promise;
    },
    connect: (io) => io('/student', {})
  });

  const pending = [getSocket(), getSocket(), getSocket(), getSocket()];
  script.resolve(client.io);
  const sockets = await Promise.all(pending);

  assert.equal(loads, 1);
  assert.equal(client.opened.length, 1);
  sockets.forEach((socket) => assert.equal(socket, client.opened[0]));
});

test('a call after the socket is open receives the same socket', async () => {
  const client = fakeClient();
  const getSocket = createSharedSocket({
    loadClient: async () => client.io,
    connect: (io) => io('/student', {})
  });

  const first = await getSocket();
  const later = await getSocket();

  assert.equal(later, first);
  assert.equal(client.opened.length, 1);
});

test('the socket is opened with the connect options', async () => {
  const client = fakeClient();
  const getSocket = createSharedSocket({
    loadClient: async () => client.io,
    connect: (io) => io('https://example.invalid/student', { withCredentials: true })
  });

  const socket = await getSocket();

  assert.equal(socket.url, 'https://example.invalid/student');
  assert.deepEqual(socket.options, { withCredentials: true });
});

test('a failed load rejects every call and opens nothing', async () => {
  const client = fakeClient();
  let loads = 0;
  const getSocket = createSharedSocket({
    loadClient: async () => {
      loads += 1;
      throw new Error('Failed to load Socket.IO client script.');
    },
    connect: (io) => io('/student', {})
  });

  await assert.rejects(getSocket(), /Failed to load/);
  await assert.rejects(getSocket(), /Failed to load/);

  assert.equal(loads, 1);
  assert.equal(client.opened.length, 0);
});

test('a client that throws synchronously rejects the call', async () => {
  const getSocket = createSharedSocket({
    loadClient: () => {
      throw new Error('Socket.IO client is only available in browser environments.');
    },
    connect: () => ({})
  });

  await assert.rejects(getSocket(), /only available in browser/);
});
