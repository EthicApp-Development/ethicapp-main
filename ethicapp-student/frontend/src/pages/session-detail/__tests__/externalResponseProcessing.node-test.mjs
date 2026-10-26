import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyResponseProcessingDelta,
  buildResponseProcessingByPhase,
  buildResponseProcessingServicesByPhase
} from '../externalResponseProcessing.js';

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
