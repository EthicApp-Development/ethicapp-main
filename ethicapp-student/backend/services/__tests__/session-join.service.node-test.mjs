import assert from 'node:assert/strict';
import test from 'node:test';
import {
  JOIN_OUTCOMES,
  joinSessionByCode,
  normalizeDevice,
  normalizeSessionCode
} from '../session-join.service.js';

const silentLogger = { info: () => {} };

// In-memory stand-in for the sessions, sesusers and stages tables. Every query
// yields to the event loop first, so concurrent joins interleave like real I/O.
function createFakeDatabase({ sessions = [], memberships = [], teamStageSessionIds = [] } = {}) {
  const sesusers = new Set(memberships.map(({ uid, sesid }) => `${uid}:${sesid}`));
  const teamStages = new Set(teamStageSessionIds);
  const inserted = [];

  async function query(text, params) {
    await new Promise((resolve) => setImmediate(resolve));

    if (text.includes('FROM sessions AS s')) {
      const [uid, code] = params;
      const session = sessions.find((candidate) => candidate.code === code);
      return session
        ? {
            rowCount: 1,
            rows: [{
              sesid: session.id,
              already_joined: sesusers.has(`${uid}:${session.id}`),
              joining_closed: teamStages.has(session.id)
            }]
          }
        : { rowCount: 0, rows: [] };
    }

    if (text.includes('INSERT INTO sesusers')) {
      const [uid, sesid, device] = params;
      const key = `${uid}:${sesid}`;

      if (sesusers.has(key)) {
        return { rowCount: 0, rows: [] };
      }

      sesusers.add(key);
      inserted.push({ uid, sesid, device });
      return { rowCount: 1, rows: [{ sesid }] };
    }

    throw new Error(`Unexpected query: ${text}`);
  }

  return { query, inserted };
}

function createFakePublisher() {
  const events = [];
  return { events, publish: async (type, version, payload) => events.push({ type, version, payload }) };
}

function join(database, publisher, overrides = {}) {
  return joinSessionByCode({
    uid: 44,
    code: 'k0021d',
    device: 'web',
    query: database.query,
    publisher,
    logger: silentLogger,
    ...overrides
  });
}

test('normalizeSessionCode trims, lower-cases and rejects malformed codes', () => {
  assert.equal(normalizeSessionCode('  K0021D '), 'k0021d');
  assert.equal(normalizeSessionCode(''), null);
  assert.equal(normalizeSessionCode('k00 21d'), null);
  assert.equal(normalizeSessionCode('k0021d;--'), null);
  assert.equal(normalizeSessionCode(42), null);
});

test('normalizeDevice accepts short labels and rejects other values', () => {
  assert.deepEqual(normalizeDevice('web'), { valid: true, device: 'web' });
  assert.deepEqual(normalizeDevice(undefined), { valid: true, device: null });
  assert.deepEqual(normalizeDevice('  '), { valid: true, device: null });
  assert.equal(normalizeDevice('x'.repeat(65)).valid, false);
  assert.equal(normalizeDevice({ name: 'web' }).valid, false);
});

test('a new participant joins and the join event is published', async () => {
  const database = createFakeDatabase({ sessions: [{ id: 57, code: 'k0021d' }] });
  const publisher = createFakePublisher();

  const result = await join(database, publisher);

  assert.deepEqual(result, { outcome: JOIN_OUTCOMES.JOINED, sessionId: 57 });
  assert.deepEqual(database.inserted, [{ uid: 44, sesid: 57, device: 'web' }]);
  assert.deepEqual(publisher.events, [{
    type: 'session-participant-joined',
    version: 1,
    payload: { sessionId: 57, userId: 44, device: 'web' }
  }]);
});

test('an existing participant gets already_joined without a new event', async () => {
  const database = createFakeDatabase({
    sessions: [{ id: 57, code: 'k0021d' }],
    memberships: [{ uid: 44, sesid: 57 }]
  });
  const publisher = createFakePublisher();

  assert.deepEqual(await join(database, publisher), { outcome: JOIN_OUTCOMES.ALREADY_JOINED, sessionId: 57 });
  assert.equal(database.inserted.length, 0);
  assert.equal(publisher.events.length, 0);
});

test('an existing participant can re-enter after the team phase started', async () => {
  const database = createFakeDatabase({
    sessions: [{ id: 57, code: 'k0021d' }],
    memberships: [{ uid: 44, sesid: 57 }],
    teamStageSessionIds: [57]
  });

  const result = await join(database, createFakePublisher());

  assert.equal(result.outcome, JOIN_OUTCOMES.ALREADY_JOINED);
});

test('an unknown code gets code_not_found', async () => {
  const database = createFakeDatabase({ sessions: [{ id: 57, code: 'k0021d' }] });
  const publisher = createFakePublisher();

  const result = await join(database, publisher, { code: 'k0012d' });

  assert.deepEqual(result, { outcome: JOIN_OUTCOMES.CODE_NOT_FOUND, sessionId: null });
  assert.equal(publisher.events.length, 0);
});

test('a session with a team stage gets joining_closed for new participants', async () => {
  const database = createFakeDatabase({
    sessions: [{ id: 57, code: 'k0021d' }],
    teamStageSessionIds: [57]
  });
  const publisher = createFakePublisher();

  const result = await join(database, publisher);

  assert.equal(result.outcome, JOIN_OUTCOMES.JOINING_CLOSED);
  assert.equal(database.inserted.length, 0);
  assert.equal(publisher.events.length, 0);
});

test('concurrent double submits produce one membership, one event and no error', async () => {
  const database = createFakeDatabase({ sessions: [{ id: 57, code: 'k0021d' }] });
  const publisher = createFakePublisher();

  const results = await Promise.all([join(database, publisher), join(database, publisher)]);

  assert.deepEqual(
    results.map(({ outcome }) => outcome).sort(),
    [JOIN_OUTCOMES.ALREADY_JOINED, JOIN_OUTCOMES.JOINED]
  );
  assert.equal(database.inserted.length, 1);
  assert.equal(publisher.events.length, 1);
});

test('every attempt writes one structured log line', async () => {
  const database = createFakeDatabase({ sessions: [{ id: 57, code: 'k0021d' }] });
  const lines = [];

  await join(database, createFakePublisher(), { logger: { info: (line) => lines.push(line) } });
  await join(database, createFakePublisher(), { code: 'zzzzzz', logger: { info: (line) => lines.push(line) } });

  assert.deepEqual(lines.map((line) => JSON.parse(line.replace('[join] ', ''))), [
    { outcome: 'joined', sessionId: 57, uid: 44, code: 'k0021d' },
    { outcome: 'code_not_found', sessionId: null, uid: 44, code: 'zzzzzz' }
  ]);
});
