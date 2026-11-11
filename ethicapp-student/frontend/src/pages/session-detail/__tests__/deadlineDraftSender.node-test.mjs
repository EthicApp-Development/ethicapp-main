import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEADLINE_DRAFT_SENDER_DEFAULTS,
  DRAFT_OUTCOMES,
  DRAFT_SEND_TRIGGERS,
  SEND_FAILED,
  createDeadlineDraftSender,
  deadlineNoticeFor,
  previousPhaseId
} from '../deadlineDraftSender.js';
import { HIDDEN_TIMER_SNAPSHOT } from '../phaseClockTracker.js';
import { unsentDrafts } from '../../../utils/phaseDrafts.js';
import { ANSWER_PROBLEMS } from '../../../utils/semanticDifferentialAnswer.js';

const T0 = Date.parse('2026-11-11T15:00:00.000Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const LEAD = DEADLINE_DRAFT_SENDER_DEFAULTS.leadMs;

// A manual device clock with timers that fire when time advances. `sleep`
// moves the time without firing them, as a background tab does.
function createClock(start = T0) {
  let current = start;
  let nextId = 1;
  const pending = new Map();

  return {
    now: () => current,
    timers: {
      setTimeout(callback, delay) {
        const id = nextId++;
        pending.set(id, { at: current + delay, callback });
        return id;
      },
      clearTimeout(id) {
        pending.delete(id);
      }
    },
    pendingCount: () => pending.size,
    async advance(ms) {
      const target = current + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort(([, a], [, b]) => a.at - b.at)[0];
        if (!due) break;
        const [id, timer] = due;
        pending.delete(id);
        current = timer.at;
        timer.callback();
        await flush();
      }
      current = target;
      await flush();
    },
    sleep(ms) {
      current += ms;
    }
  };
}

async function flush() {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function phaseFixture(id, number, responses = []) {
  return {
    id,
    number,
    tasks: [
      { id: id * 10 + 1, order: 1, numValues: 5, requiresJustification: true, minWordCount: 2 },
      { id: id * 10 + 2, order: 2, numValues: 5, requiresJustification: false }
    ],
    responses
  };
}

// The sender with the page's drafts and phases, a fake server and a manual
// clock. `respond` decides each submit's answer (resolves by default).
function createHarness({ respond = () => Promise.resolve({ status: 'ok' }), phases } = {}) {
  const clock = createClock();
  const page = {
    phases: phases ?? [phaseFixture(31, 1), phaseFixture(32, 2)],
    drafts: {}
  };
  const submits = [];
  const reports = [];
  const reloads = [];

  const sender = createDeadlineDraftSender({
    collectUnsent: (phaseId) => unsentDrafts(page.phases.find((phase) => phase.id === phaseId), page.drafts[phaseId]),
    submit: (payload) => {
      submits.push({ ...payload, at: clock.now() });
      return respond(payload);
    },
    afterSent: (sent) => {
      reloads.push(sent);
    },
    onOutcome: (report) => reports.push(report),
    timers: clock.timers,
    now: clock.now
  });

  return {
    clock,
    page,
    sender,
    submits,
    reports,
    reloads,
    finalReports: () => reports.filter((report) => report.final)
  };
}

function hardSnapshot(clock, { phaseId = 31, untilDeadline = 2 * MINUTE, deadlineAt, ...rest } = {}) {
  const at = deadlineAt ?? clock.now() + untilDeadline;
  return {
    ...HIDDEN_TIMER_SNAPSHOT,
    state: 'running',
    timeMode: 'hard',
    phaseId,
    phaseNumber: phaseId - 30,
    isLastPhase: false,
    deadlineAt: at,
    remainingSeconds: Math.max(0, Math.ceil((at - clock.now()) / SECOND)),
    deadlineReached: at <= clock.now(),
    hardDeadline: true,
    ...rest
  };
}

const VALID = { value: 3, justification: 'Porque corresponde' };

test('sends a hard phase\'s unsent answers shortly before its deadline, to that phase', async () => {
  const { clock, page, sender, submits, reports, reloads } = createHarness();
  page.drafts[31] = { 311: VALID };

  sender.timerChanged(hardSnapshot(clock, { untilDeadline: 2 * MINUTE }));
  await clock.advance(2 * MINUTE - LEAD - 1);
  assert.equal(submits.length, 0);

  await clock.advance(1);
  assert.deepEqual(submits.map(({ phaseId, questionId, value, justification }) => ({ phaseId, questionId, value, justification })), [
    { phaseId: 31, questionId: 311, value: 3, justification: 'Porque corresponde' }
  ]);
  assert.equal(submits[0].at, T0 + 2 * MINUTE - LEAD);
  assert.deepEqual(reloads, [{ phaseId: 31, taskIds: [311] }]);
  assert.equal(reports.at(-1).trigger, DRAFT_SEND_TRIGGERS.BEFORE_DEADLINE);
  assert.equal(reports.at(-1).final, false, 'nothing is said before 00:00');
  assert.deepEqual(reports.at(-1).outcomes, { 311: { status: DRAFT_OUTCOMES.SENT, reason: null } });
});

test('sends at 00:00 only what changed since, and reports the phase\'s outcome', async () => {
  const { clock, page, sender, submits, finalReports } = createHarness();
  page.drafts[31] = { 311: VALID };

  sender.timerChanged(hardSnapshot(clock, { untilDeadline: MINUTE }));
  await clock.advance(MINUTE - LEAD);
  assert.equal(submits.length, 1);

  // The page has not reloaded the stored answers yet; the student goes on.
  page.drafts[31] = { 311: VALID, 312: { value: 5 } };
  await clock.advance(LEAD);

  assert.deepEqual(submits.map(({ questionId }) => questionId), [311, 312]);
  assert.equal(finalReports().length, 1);
  assert.equal(finalReports()[0].trigger, DRAFT_SEND_TRIGGERS.DEADLINE);
  assert.deepEqual(finalReports()[0].outcomes, {
    311: { status: DRAFT_OUTCOMES.SENT, reason: null },
    312: { status: DRAFT_OUTCOMES.SENT, reason: null }
  });
});

test('after an advance at the deadline, sends to the previous phase', async () => {
  const { clock, page, sender, submits, finalReports } = createHarness();

  sender.timerChanged(hardSnapshot(clock, { untilDeadline: 30 * SECOND }));
  await clock.advance(30 * SECOND);
  assert.equal(submits.length, 0, 'nothing was typed yet');

  // Typed during the last second, after the 00:00 send.
  page.drafts[31] = { 311: VALID };
  sender.timerChanged(HIDDEN_TIMER_SNAPSHOT);
  await sender.phaseTransition({ sessionId: 7, phaseId: 32, phaseNumber: 2, reason: 'deadline' }, 31);

  assert.deepEqual(submits.map(({ phaseId, questionId }) => [phaseId, questionId]), [[31, 311]]);
  assert.equal(finalReports().at(-1).trigger, DRAFT_SEND_TRIGGERS.TRANSITION);
  assert.equal(finalReports().at(-1).phaseId, 31);
});

test('the 00:00 send and the transition send an answer once', async () => {
  const answer = deferred();
  const { clock, page, sender, submits } = createHarness({ respond: () => answer.promise });
  page.drafts[31] = { 311: VALID };

  // The page loaded with less than the lead left: both timers fire at once.
  sender.timerChanged(hardSnapshot(clock, { untilDeadline: 5 * SECOND }));
  await clock.advance(5 * SECOND);
  assert.equal(submits.length, 1, 'the 00:00 send skips the answer in flight');

  // The transition arrives while the send is in flight, then again (duplicate event).
  const transition = sender.phaseTransition({ phaseId: 32, phaseNumber: 2, reason: 'deadline' }, 31);
  answer.resolve({ status: 'ok' });
  await transition;
  await sender.phaseTransition({ phaseId: 32, phaseNumber: 2, reason: 'deadline' }, 31);
  await flush();

  assert.equal(submits.length, 1);
});

test('does not send again an answer sent with the same content, before the reload', async () => {
  const { clock, page, sender, submits } = createHarness();
  page.drafts[31] = { 311: VALID };

  sender.timerChanged(hardSnapshot(clock, { untilDeadline: 20 * SECOND }));
  await clock.advance(20 * SECOND);
  await sender.phaseTransition({ phaseId: 32, phaseNumber: 2, reason: 'deadline' }, 31);

  assert.equal(submits.length, 1);
});

test('does not send an answer the student already submitted', async () => {
  const { clock, page, sender, submits } = createHarness({
    phases: [phaseFixture(31, 1, [{ taskId: 311, selection: 3, justification: 'Porque corresponde' }])]
  });
  // The draft equals the stored answer.
  page.drafts[31] = { 311: { ...VALID, justification: ' Porque corresponde ' } };

  sender.timerChanged(hardSnapshot(clock, { untilDeadline: 20 * SECOND }));
  await clock.advance(20 * SECOND);

  assert.equal(submits.length, 0);
});

test('the student\'s own submit holds the automatic one back, and counts as sent', async () => {
  const manual = deferred();
  const { clock, page, sender, submits, finalReports } = createHarness();
  page.drafts[31] = { 311: VALID };

  sender.timerChanged(hardSnapshot(clock, { untilDeadline: 20 * SECOND }));
  const own = sender.trackManual({ phaseId: 31, questionId: 311, ...VALID }, () => manual.promise);

  await clock.advance(20 * SECOND - LEAD);
  assert.equal(submits.length, 0, 'the task has a submit in flight');

  manual.resolve({ ok: true });
  assert.deepEqual(await own, { ok: true });
  await clock.advance(LEAD);

  assert.equal(submits.length, 0, 'the same content is not sent again');
  assert.deepEqual(finalReports().at(-1)?.outcomes ?? {}, {}, 'nothing was sent for the student');
});

test('never sends what the server would refuse, and says why it was kept', async () => {
  const { clock, page, sender, submits, finalReports } = createHarness();
  page.drafts[31] = {
    311: { value: 3, justification: 'corta' },
    312: { justification: 'Sin valor elegido' }
  };

  sender.timerChanged(hardSnapshot(clock, { untilDeadline: 20 * SECOND }));
  await clock.advance(20 * SECOND);

  assert.equal(submits.length, 0);
  assert.deepEqual(finalReports().at(-1).outcomes, {
    311: { status: DRAFT_OUTCOMES.KEPT, reason: ANSWER_PROBLEMS.JUSTIFICATION_TOO_SHORT },
    312: { status: DRAFT_OUTCOMES.KEPT, reason: ANSWER_PROBLEMS.MISSING_VALUE }
  });
});

test('a draft completed after the first trigger is sent by the next one', async () => {
  const { clock, page, sender, submits, finalReports } = createHarness();
  page.drafts[31] = { 311: { value: 3 } };

  sender.timerChanged(hardSnapshot(clock, { untilDeadline: 20 * SECOND }));
  await clock.advance(20 * SECOND - LEAD);
  assert.equal(submits.length, 0);

  page.drafts[31] = { 311: VALID };
  await clock.advance(LEAD);

  assert.equal(submits.length, 1);
  assert.deepEqual(finalReports().at(-1).outcomes, { 311: { status: DRAFT_OUTCOMES.SENT, reason: null } });
});

test('a refused send is kept, and only a later trigger tries it again', async () => {
  const refusal = Object.assign(new Error('Conflict'), { response: { status: 409, data: { code: 'PHASE_CHANGED' } } });
  let refuse = true;
  const { clock, page, sender, submits, reports, finalReports } = createHarness({
    respond: () => (refuse ? Promise.reject(refusal) : Promise.resolve({ status: 'ok' }))
  });
  page.drafts[31] = { 311: VALID };

  sender.timerChanged(hardSnapshot(clock, { untilDeadline: 20 * SECOND }));
  await clock.advance(20 * SECOND - LEAD);
  assert.equal(submits.length, 1);
  assert.deepEqual(reports.at(-1).outcomes, { 311: { status: DRAFT_OUTCOMES.KEPT, reason: SEND_FAILED } });

  refuse = false;
  await clock.advance(LEAD);
  assert.equal(submits.length, 2);
  assert.deepEqual(finalReports().at(-1).outcomes, { 311: { status: DRAFT_OUTCOMES.SENT, reason: null } });

  refuse = true;
  page.drafts[31] = { 311: { ...VALID, value: 4 } };
  await sender.phaseTransition({ phaseId: 32, phaseNumber: 2, reason: 'deadline' }, 31);
  await clock.advance(MINUTE);
  assert.equal(submits.length, 3, 'one try at the transition, no loop');
  assert.deepEqual(finalReports().at(-1).outcomes, { 311: { status: DRAFT_OUTCOMES.KEPT, reason: SEND_FAILED } });
});

test('sends nothing in soft mode or without a time mode', async () => {
  const { clock, page, sender, submits } = createHarness();
  page.drafts[31] = { 311: VALID };

  sender.timerChanged(hardSnapshot(clock, { timeMode: 'soft', hardDeadline: false, untilDeadline: 20 * SECOND }));
  await clock.advance(MINUTE);
  sender.timerChanged(hardSnapshot(clock, { timeMode: 'soft', hardDeadline: false, untilDeadline: 0, state: 'timeUp' }));
  await clock.advance(MINUTE);
  sender.timerChanged(HIDDEN_TIMER_SNAPSHOT);
  await sender.phaseTransition({ phaseId: 32, phaseNumber: 2, reason: 'teacher' }, 31);
  await clock.advance(MINUTE);

  assert.equal(submits.length, 0);
  assert.equal(clock.pendingCount(), 0);
});

test('a teacher\'s advance before the deadline cancels the sends', async () => {
  const { clock, page, sender, submits } = createHarness();
  page.drafts[31] = { 311: VALID };

  sender.timerChanged(hardSnapshot(clock, { untilDeadline: MINUTE }));
  await clock.advance(30 * SECOND);
  await sender.phaseTransition({ phaseId: 32, phaseNumber: 2, reason: 'teacher' }, 31);
  await clock.advance(MINUTE);

  assert.equal(submits.length, 0);
  assert.equal(clock.pendingCount(), 0);
});

test('a duplicate transition of the current phase leaves its deadline watched', async () => {
  const { clock, page, sender, submits } = createHarness();
  page.drafts[32] = { 321: VALID };

  sender.timerChanged(hardSnapshot(clock, { phaseId: 32, untilDeadline: MINUTE }));
  await sender.phaseTransition({ phaseId: 32, phaseNumber: 2, reason: 'teacher' }, 31);
  await clock.advance(MINUTE);

  assert.deepEqual(submits.map(({ phaseId }) => phaseId), [32]);
});

test('a page that sees the deadline only after it passed sends nothing for it', async () => {
  const { clock, page, sender, submits } = createHarness();
  page.drafts[31] = { 311: VALID };

  sender.timerChanged(hardSnapshot(clock, { untilDeadline: -5 * SECOND, state: 'timeUp', isLastPhase: true }));
  await clock.advance(MINUTE);

  assert.equal(submits.length, 0);
});

test('added time re-arms the sends for the new deadline', async () => {
  const { clock, page, sender, submits } = createHarness();
  page.drafts[31] = { 311: VALID };
  const firstDeadline = clock.now() + 20 * SECOND;

  sender.timerChanged(hardSnapshot(clock, { deadlineAt: firstDeadline }));
  await clock.advance(20 * SECOND - LEAD);
  assert.equal(submits.length, 1);

  // A clock read again moves the deadline by a few milliseconds: same deadline.
  sender.timerChanged(hardSnapshot(clock, { deadlineAt: firstDeadline + 40 }));
  // "+1 min".
  sender.timerChanged(hardSnapshot(clock, { deadlineAt: firstDeadline + MINUTE }));
  page.drafts[31] = { 311: { ...VALID, value: 1 } };
  await clock.advance(LEAD);
  assert.equal(submits.length, 1, 'the old 00:00 no longer applies');

  await clock.advance(MINUTE - LEAD - 1);
  assert.equal(submits.length, 1);
  await clock.advance(1);
  assert.equal(submits.length, 2, `${LEAD} ms before the new deadline`);
  assert.equal(submits[1].value, 1);
});

test('on the last phase, sends before and at 00:00 and reports, with no transition', async () => {
  const { clock, page, sender, submits, finalReports } = createHarness({ phases: [phaseFixture(31, 1)] });
  page.drafts[31] = { 311: { value: 2 } };

  sender.timerChanged(hardSnapshot(clock, { untilDeadline: 20 * SECOND, isLastPhase: true }));
  await clock.advance(20 * SECOND - LEAD);
  page.drafts[31] = { 311: VALID };
  await clock.advance(LEAD);
  sender.timerChanged(hardSnapshot(clock, { deadlineAt: T0 + 20 * SECOND, isLastPhase: true, state: 'timeUp' }));
  await clock.advance(MINUTE);

  assert.equal(submits.length, 1);
  assert.equal(finalReports().length, 1);
  assert.equal(finalReports()[0].trigger, DRAFT_SEND_TRIGGERS.DEADLINE);
});

test('a snapshot at 00:00 sends when a background tab held the timer back', async () => {
  const { clock, page, sender, submits } = createHarness();
  page.drafts[31] = { 311: VALID };

  sender.timerChanged(hardSnapshot(clock, { untilDeadline: 30 * SECOND }));
  clock.sleep(31 * SECOND);
  sender.timerChanged(hardSnapshot(clock, { deadlineAt: T0 + 30 * SECOND, state: 'advancing' }));
  await flush();

  assert.equal(submits.length, 1);
  await clock.advance(SECOND);
  assert.equal(submits.length, 1, 'the late timers find nothing left to send');
});

test('a transition at the deadline without a known previous phase sends nothing', async () => {
  const { page, sender, submits } = createHarness();
  page.drafts[31] = { 311: VALID };

  await sender.phaseTransition({ phaseId: 31, phaseNumber: 1, reason: 'deadline' }, null);

  assert.equal(submits.length, 0);
});

test('sends nothing once disposed', async () => {
  const { clock, page, sender, submits } = createHarness();
  page.drafts[31] = { 311: VALID };

  sender.timerChanged(hardSnapshot(clock, { untilDeadline: MINUTE }));
  sender.dispose();
  await clock.advance(2 * MINUTE);
  await sender.phaseTransition({ phaseId: 32, phaseNumber: 2, reason: 'deadline' }, 31);

  assert.equal(submits.length, 0);
});

test('finds the phase before an advance', () => {
  const phases = [{ id: 31, number: 1 }, { id: 33, number: 3 }, { id: 32, number: 2 }];
  assert.equal(previousPhaseId(phases, 3), 32);
  assert.equal(previousPhaseId(phases, 4), 33);
  assert.equal(previousPhaseId(phases, 1), null);
  assert.equal(previousPhaseId(phases, null), null);
  assert.equal(previousPhaseId(undefined, 2), null);
});

test('builds the notice from the outcomes', () => {
  assert.deepEqual(deadlineNoticeFor(31, 1, {
    1: { status: DRAFT_OUTCOMES.SENT },
    2: { status: DRAFT_OUTCOMES.SENT },
    3: { status: DRAFT_OUTCOMES.KEPT, reason: SEND_FAILED }
  }), { phaseId: 31, phaseNumber: 1, sent: 2, kept: 1 });
  assert.equal(deadlineNoticeFor(31, 1, {}), null);
  assert.equal(deadlineNoticeFor(31, 1, { 1: { status: DRAFT_OUTCOMES.SENDING } }), null);
});
