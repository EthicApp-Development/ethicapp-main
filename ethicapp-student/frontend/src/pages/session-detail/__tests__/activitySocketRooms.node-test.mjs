// The catch-up load once the student's room is joined (#1143). A result
// stored after the opening load and before the socket's first connection
// reaches neither that load nor the socket, so the page loads again once the
// server acknowledges the room's join. The fake socket buffers emits while it
// is disconnected and sends them when it connects, as the Socket.IO client
// does; the fake server joins the room and acknowledges it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { activityRoomJoins, joinActivityRooms } from '../activitySocketRooms.js';
import { createExternalResultsLoader, createReconnectTracker } from '../externalResultsLoading.js';
import {
  liveExternalResult,
  loadedExternalResults,
  mergeExternalResults,
  unseenExternalResults
} from '../externalServiceResults.js';

const SESSION_ID = 12;
const USER_ID = 7;

const flush = () => new Promise((resolve) => setImmediate(resolve));

// The stored results, the student's room and its events.
function fakeServer() {
  const server = {
    stored: [],
    roomJoined: false,
    sessionRoomJoined: false,
    sockets: [],
    receive(socket, event, args) {
      if (event === 'joinSession') {
        server.sessionRoomJoined = true;
      }
      if (event === 'joinUser') {
        server.roomJoined = true;
        const ack = args.at(-1);
        // The acknowledgement travels back after the join.
        if (typeof ack === 'function') setImmediate(() => ack({ ok: true }));
      }
    },
    // A connection that drops loses its rooms, as on the Socket.IO server.
    drop() {
      server.roomJoined = false;
      server.sessionRoomJoined = false;
      server.sockets.forEach((socket) => { socket.connected = false; });
    },
    startPhase() {
      if (server.sessionRoomJoined) {
        server.sockets.forEach((socket) => socket.deliver('onPhaseTransition'));
      }
    },
    publish(result) {
      server.stored.push(result);
      if (server.roomJoined) {
        server.sockets.forEach((socket) => socket.deliver('onExternalServiceResult', result));
      }
    }
  };
  return server;
}

function fakeSocket(server, { connected = false } = {}) {
  const buffer = [];
  const handlers = new Map();
  const socket = {
    connected,
    emitted: [],
    emit(event, ...args) {
      socket.emitted.push(event);
      if (socket.connected) server.receive(socket, event, args);
      else buffer.push([event, args]);
    },
    on(event, handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    deliver(event, payload) {
      (handlers.get(event) ?? []).forEach((handler) => handler(payload));
    },
    failToConnect() {
      socket.deliver('connect_error', new Error('handshake refused'));
    },
    connect() {
      socket.connected = true;
      socket.deliver('connect');
      buffer.splice(0).forEach(([event, args]) => server.receive(socket, event, args));
    }
  };
  server.sockets.push(socket);
  return socket;
}

// The page: shows each result once, from the load or from the event, counts
// the loads and the phase changes it hears, and joins its rooms again after a
// reconnect, loading once the student's room is back, as
// useActivityRealtimeSync does (#1108).
function fakePage(server, socket) {
  const page = { shown: [], seen: new Set(), loads: 0, transitions: 0 };
  const show = (entries) => {
    unseenExternalResults(page.seen, entries).forEach((entry) => page.seen.add(entry.key));
    page.shown = mergeExternalResults(page.shown, entries);
  };
  page.loader = createExternalResultsLoader({
    fetchResults: async () => {
      page.loads += 1;
      return [...server.stored];
    },
    applyResults: (results) => show(loadedExternalResults(results))
  });
  const tracker = createReconnectTracker({ connected: socket.connected });
  socket.on('connect', () => {
    if (tracker.handleConnect()) {
      joinActivityRooms(socket, {
        sessionId: SESSION_ID,
        userId: USER_ID,
        onUserRoomJoined: page.loader.reconnected
      });
    }
  });
  socket.on('onPhaseTransition', () => {
    page.transitions += 1;
  });
  socket.on('onExternalServiceResult', (payload) => {
    const entry = liveExternalResult(payload);
    if (entry) show([entry]);
  });
  return page;
}

const shownIds = (page) => page.shown.map((result) => result.resultId);

test('a result stored before the first connection is loaded once the room is joined', async () => {
  const server = fakeServer();
  const socket = fakeSocket(server);
  const page = fakePage(server, socket);

  page.loader.open({ sessionId: SESSION_ID, userId: USER_ID });
  joinActivityRooms(socket, {
    sessionId: SESSION_ID,
    userId: USER_ID,
    onUserRoomJoined: page.loader.subscribed
  });
  await flush();
  assert.deepEqual(shownIds(page), [], 'the opening load found nothing');

  server.publish({ resultId: 'missed-result', phaseId: 21 });
  assert.equal(server.roomJoined, false, 'the join waits in the buffer');

  socket.connect();
  await flush();
  await flush();

  assert.deepEqual(socket.emitted, ['joinSession', 'joinUser']);
  assert.equal(page.loads, 2, 'the opening load and the catch-up load');
  assert.deepEqual(shownIds(page), ['missed-result']);
});

test('a first connection that fails at first is caught up when it succeeds', async () => {
  const server = fakeServer();
  const socket = fakeSocket(server);
  const page = fakePage(server, socket);

  page.loader.open({ sessionId: SESSION_ID, userId: USER_ID });
  joinActivityRooms(socket, {
    sessionId: SESSION_ID,
    userId: USER_ID,
    onUserRoomJoined: page.loader.subscribed
  });
  await flush();
  socket.failToConnect();
  server.publish({ resultId: 'during-failure', phaseId: 21 });
  socket.failToConnect();
  await flush();
  assert.deepEqual(shownIds(page), []);

  socket.connect();
  await flush();
  await flush();

  assert.deepEqual(shownIds(page), ['during-failure']);
});

test('an already connected socket loads once its room is joined', async () => {
  const server = fakeServer();
  const socket = fakeSocket(server, { connected: true });
  const page = fakePage(server, socket);

  page.loader.open({ sessionId: SESSION_ID, userId: USER_ID });
  // Stored after the opening load read its snapshot, before the join.
  await flush();
  server.publish({ resultId: 'before-join', phaseId: 21 });
  joinActivityRooms(socket, {
    sessionId: SESSION_ID,
    userId: USER_ID,
    onUserRoomJoined: page.loader.subscribed
  });
  await flush();
  await flush();

  assert.deepEqual(shownIds(page), ['before-join']);
});

test('a result that arrives as an event and in the catch-up load is shown once', async () => {
  const server = fakeServer();
  const socket = fakeSocket(server);
  const page = fakePage(server, socket);

  page.loader.open({ sessionId: SESSION_ID, userId: USER_ID });
  joinActivityRooms(socket, {
    sessionId: SESSION_ID,
    userId: USER_ID,
    onUserRoomJoined: page.loader.subscribed
  });
  await flush();
  socket.connect();
  // Published after the join and before the acknowledgement's load answers:
  // it comes both as an event and in the load.
  server.publish({ resultId: 'both-ways', phaseId: 21 });
  await flush();
  await flush();

  assert.deepEqual(shownIds(page), ['both-ways']);
  assert.equal(page.seen.size, 1);
});

test('an acknowledgement for an activity that closed is ignored', async () => {
  const server = fakeServer();
  const socket = fakeSocket(server);
  let joined = 0;
  let active = true;

  joinActivityRooms(socket, {
    sessionId: SESSION_ID,
    userId: USER_ID,
    onUserRoomJoined: () => { joined += 1; },
    isActive: () => active
  });
  active = false;
  socket.connect();
  await flush();

  assert.equal(joined, 0);
});

test('a reconnect still loads, and the first connect does not count as one', async () => {
  const server = fakeServer();
  const socket = fakeSocket(server);
  const page = fakePage(server, socket);

  page.loader.open({ sessionId: SESSION_ID, userId: USER_ID });
  joinActivityRooms(socket, {
    sessionId: SESSION_ID,
    userId: USER_ID,
    onUserRoomJoined: page.loader.subscribed
  });
  socket.connect();
  await flush();
  await flush();
  assert.equal(page.loads, 2, 'the opening load and the catch-up load');

  server.drop();
  server.publish({ resultId: 'while-down', phaseId: 21 });
  socket.connect();
  await flush();
  await flush();

  assert.equal(page.loads, 3);
  assert.deepEqual(shownIds(page), ['while-down']);
});

// ─── Rooms after a reconnect (#1108) ────────────────────────────────────────

test('the joins list the session, the student and, with a group, the group', () => {
  assert.deepEqual(activityRoomJoins({ sessionId: 12, userId: 7 }), [['joinSession', 12], ['joinUser', 7]]);
  assert.deepEqual(activityRoomJoins({ sessionId: 12, userId: 7, groupId: 30 }),
    [['joinSession', 12], ['joinUser', 7], ['joinGroup', 30]]);
  for (const groupId of [null, undefined, 0, -1, 'x', 1.5]) {
    assert.equal(activityRoomJoins({ sessionId: 12, userId: 7, groupId }).length, 2, String(groupId));
  }
});

test('joining a group room emits it after the session and student rooms', () => {
  const server = fakeServer();
  const socket = fakeSocket(server, { connected: true });

  joinActivityRooms(socket, { sessionId: SESSION_ID, userId: USER_ID, groupId: '30' });

  assert.deepEqual(socket.emitted, ['joinSession', 'joinUser', 'joinGroup']);
});

test('after a reconnect, phase changes and results reach the socket again', async () => {
  const server = fakeServer();
  const socket = fakeSocket(server);
  const page = fakePage(server, socket);

  page.loader.open({ sessionId: SESSION_ID, userId: USER_ID });
  joinActivityRooms(socket, { sessionId: SESSION_ID, userId: USER_ID, onUserRoomJoined: page.loader.subscribed });
  socket.connect();
  await flush();
  server.startPhase();
  assert.equal(page.transitions, 1);

  server.drop();
  server.startPhase();
  assert.equal(page.transitions, 1, 'nothing reaches a dropped connection');
  socket.connect();
  await flush();
  await flush();

  server.startPhase();
  server.publish({ resultId: 'after-reconnect', phaseId: 22 });
  assert.equal(page.transitions, 2, 'the session room was joined again');
  assert.deepEqual(shownIds(page), ['after-reconnect']);
  assert.deepEqual(socket.emitted, ['joinSession', 'joinUser', 'joinSession', 'joinUser']);
});
