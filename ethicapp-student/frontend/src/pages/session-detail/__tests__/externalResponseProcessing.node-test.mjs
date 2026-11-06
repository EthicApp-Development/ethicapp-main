import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyResponseProcessingDelta,
  buildResponseProcessingByPhase,
  buildResponseProcessingServicesByPhase,
  processingResolvedByResults
} from '../externalResponseProcessing.js';
import { unseenExternalResults } from '../externalServiceResults.js';

test('buildResponseProcessingServicesByPhase selects enabled response-processing services only', () => {
  const phases = [
    { id: 10, number: 1 },
    { id: 20, number: 2 }
  ];
  const design = {
    phases: [
      {
        externalServices: {
          enabledServiceIds: ['reviewer-a', 'chat-only', 'reviewer-b']
        }
      },
      {
        externalServices: {
          enabledServiceIds: ['reviewer-b']
        }
      }
    ]
  };
  const services = [
    {
      id: 'reviewer-a',
      enabled: true,
      scopes: ['response']
    },
    {
      id: 'reviewer-b',
      enabled: true,
      scopes: ['response', 'chat']
    },
    {
      id: 'chat-only',
      enabled: true,
      scopes: ['chat']
    }
  ];

  assert.deepEqual(
    buildResponseProcessingServicesByPhase({ phases, design, services }),
    {
      10: ['reviewer-a', 'reviewer-b'],
      20: ['reviewer-b']
    }
  );
});

test('buildResponseProcessingServicesByPhase ignores disabled services and services without the response scope', () => {
  const phases = [{ id: 10, number: 1 }];
  const design = {
    phases: [
      {
        externalServices: {
          enabledServiceIds: ['reviewer-a', 'reviewer-b', 'reviewer-c', 'legacy-capability']
        }
      }
    ]
  };
  const services = [
    {
      id: 'reviewer-a',
      enabled: false,
      scopes: ['response']
    },
    {
      id: 'reviewer-b',
      enabled: true
    },
    {
      id: 'reviewer-c',
      enabled: true,
      scopes: ['response']
    },
    {
      // The old flag alone no longer marks a response processor.
      id: 'legacy-capability',
      enabled: true,
      scopes: ['chat'],
      capabilities: { processesStudentResponses: true }
    }
  ];

  assert.deepEqual(
    buildResponseProcessingServicesByPhase({ phases, design, services }),
    {
      10: ['reviewer-c']
    }
  );
});

test('applyResponseProcessingDelta tracks pending work by phase and service', () => {
  const first = applyResponseProcessingDelta({}, {
    phaseId: 10,
    serviceId: 'reviewer-a',
    delta: 1
  });
  const second = applyResponseProcessingDelta(first, {
    phaseId: 10,
    serviceId: 'reviewer-b',
    delta: 1
  });
  const third = applyResponseProcessingDelta(second, {
    phaseId: 10,
    serviceId: 'reviewer-a',
    delta: -1
  });

  assert.deepEqual(second, {
    10: {
      'reviewer-a': 1,
      'reviewer-b': 1
    }
  });
  assert.deepEqual(third, {
    10: {
      'reviewer-b': 1
    }
  });
  assert.deepEqual(buildResponseProcessingByPhase(third), { 10: true });
});

test('applyResponseProcessingDelta removes empty phase entries', () => {
  const state = applyResponseProcessingDelta({
    10: {
      'reviewer-a': 1
    }
  }, {
    phaseId: 10,
    serviceId: 'reviewer-a',
    delta: -1
  });

  assert.deepEqual(state, {});
  assert.deepEqual(buildResponseProcessingByPhase(state), {});
});

test('processingResolvedByResults ends one state per result of a processing service', () => {
  const servicesByPhaseId = { 10: ['reviewer-a'], 20: ['reviewer-b'] };

  assert.deepEqual(processingResolvedByResults([
    { key: 'result:1', phaseId: 10, serviceId: 'reviewer-a' },
    { key: 'result:2', phaseId: '20', serviceId: ' reviewer-b ' },
    { key: 'result:3', phaseId: 10, serviceId: 'reviewer-b' },
    { key: 'result:4', phaseId: null, serviceId: 'reviewer-a' },
    { key: 'result:5', phaseId: 30, serviceId: 'reviewer-a' }
  ], servicesByPhaseId), [
    { phaseId: 10, serviceId: 'reviewer-a' },
    { phaseId: 20, serviceId: 'reviewer-b' }
  ]);
  assert.deepEqual(processingResolvedByResults(undefined, servicesByPhaseId), []);
});

test('a response whose result was loaded first shows no processing state', () => {
  const servicesByPhaseId = { 10: ['reviewer-a'] };
  const shownKeys = new Set();
  const started = { phaseId: 10, serviceId: 'reviewer-a', delta: 1 };
  let pending = applyResponseProcessingDelta({}, started);

  const show = (entries) => {
    const unseen = unseenExternalResults(shownKeys, entries);
    unseen.forEach((entry) => shownKeys.add(entry.key));
    processingResolvedByResults(unseen, servicesByPhaseId).forEach(({ phaseId, serviceId }) => {
      pending = applyResponseProcessingDelta(pending, { phaseId, serviceId, delta: -1 });
    });
  };
  const result = { key: 'result:1', phaseId: 10, serviceId: 'reviewer-a' };

  // Loaded after a reconnect, before its socket event.
  show([result]);
  assert.deepEqual(buildResponseProcessingByPhase(pending), {});

  // A second response starts processing; the late event of the first one
  // does not end it.
  pending = applyResponseProcessingDelta(pending, started);
  show([result]);
  assert.deepEqual(buildResponseProcessingByPhase(pending), { 10: true });
});
