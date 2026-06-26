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
      capabilities: { processesStudentResponses: true }
    },
    {
      id: 'reviewer-b',
      enabled: true,
      capabilities: { processesStudentResponses: true }
    },
    {
      id: 'chat-only',
      enabled: true,
      capabilities: { processesStudentResponses: false }
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

test('buildResponseProcessingServicesByPhase ignores disabled services and services without capability', () => {
  const phases = [{ id: 10, number: 1 }];
  const design = {
    phases: [
      {
        externalServices: {
          enabledServiceIds: ['reviewer-a', 'reviewer-b', 'reviewer-c']
        }
      }
    ]
  };
  const services = [
    {
      id: 'reviewer-a',
      enabled: false,
      capabilities: { processesStudentResponses: true }
    },
    {
      id: 'reviewer-b',
      enabled: true,
      capabilities: {}
    },
    {
      id: 'reviewer-c',
      enabled: true,
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
