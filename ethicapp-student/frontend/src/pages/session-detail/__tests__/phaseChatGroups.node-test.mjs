// The student's group in each phase with chat (#1168): earlier phases and
// every phase of a finished activity get their group, so their chat opens
// read-only; the current phase stays with the socket's group resolution.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chatPhaseIdsToResolve,
  phaseGroupFromUserGroup,
  withPhaseGroupContext,
  withPhaseGroupId
} from '../phaseChatGroups.js';

const PHASES = [
  { id: 11, features: { chat: true } },
  { id: 12, features: { chat: false } },
  { id: 13, features: { chat: true } },
  { id: 14 }
];

const USER_GROUP = {
  team_id: 40,
  phase_anonymous: true,
  participants: [{ user_id: 7, anon_mask: 'A', firstname: 'Ana', lastname: 'Ríos', name: 'Ana Ríos' }]
};

test('an activity in progress resolves the chat phases other than the current one', () => {
  assert.deepEqual(chatPhaseIdsToResolve(PHASES, 13, new Set()), [11]);
});

test('a finished activity, with no current phase, resolves every chat phase', () => {
  assert.deepEqual(chatPhaseIdsToResolve(PHASES, null, new Set()), [11, 13]);
  assert.deepEqual(chatPhaseIdsToResolve(PHASES, undefined, new Set()), [11, 13]);
});

test('a phase already requested is not requested again', () => {
  assert.deepEqual(chatPhaseIdsToResolve(PHASES, null, new Set([11])), [13]);
  assert.deepEqual(chatPhaseIdsToResolve(PHASES, null, new Set([11, 13])), []);
});

test('phases without chat, without a valid id, or no phases at all resolve nothing', () => {
  assert.deepEqual(chatPhaseIdsToResolve([{ id: 0, features: { chat: true } }, { features: { chat: true } }], null, new Set()), []);
  assert.deepEqual(chatPhaseIdsToResolve([{ id: 5, features: { chat: 'true' } }], null, new Set()), []);
  assert.deepEqual(chatPhaseIdsToResolve(null, null, new Set()), []);
});

test('a user_group answer gives the group id and the context the chat labels authors with', () => {
  assert.deepEqual(phaseGroupFromUserGroup(USER_GROUP), {
    groupId: 40,
    context: { phaseAnonymous: true, participants: USER_GROUP.participants }
  });
  assert.deepEqual(phaseGroupFromUserGroup({ team_id: '41' }), {
    groupId: 41,
    context: { phaseAnonymous: false, participants: [] }
  });
});

test('a student without a group in the phase gets no group', () => {
  assert.equal(phaseGroupFromUserGroup({ team_id: null, participants: [] }), null);
  assert.equal(phaseGroupFromUserGroup({}), null);
  assert.equal(phaseGroupFromUserGroup(null), null);
});

test('storing a phase group adds it and keeps the other phases', () => {
  const phaseGroup = phaseGroupFromUserGroup(USER_GROUP);
  const ids = { 13: 50 };
  const contexts = { 13: { phaseAnonymous: false, participants: [] } };

  assert.deepEqual(withPhaseGroupId(ids, 11, phaseGroup), { 13: 50, 11: 40 });
  assert.deepEqual(withPhaseGroupContext(contexts, 11, phaseGroup), { ...contexts, 11: phaseGroup.context });
});

test('an unchanged phase group keeps the maps as they are', () => {
  const phaseGroup = phaseGroupFromUserGroup(USER_GROUP);
  const ids = { 11: 40 };
  const contexts = { 11: { phaseAnonymous: true, participants: [...USER_GROUP.participants] } };

  assert.equal(withPhaseGroupId(ids, 11, phaseGroup), ids);
  assert.equal(withPhaseGroupContext(contexts, 11, phaseGroup), contexts);
});

test('no group removes the phase, and leaves maps without it unchanged', () => {
  const ids = { 11: 40, 13: 50 };
  const contexts = { 11: { phaseAnonymous: true, participants: [] } };

  assert.deepEqual(withPhaseGroupId(ids, 11, null), { 13: 50 });
  assert.deepEqual(withPhaseGroupContext(contexts, 11, null), {});
  assert.equal(withPhaseGroupId(ids, 12, null), ids);
  assert.equal(withPhaseGroupContext(contexts, 12, null), contexts);
});
