// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../app/providers.jsx';
import { fetchUserById, fetchUsers } from '../../api/usersApi.js';
import {
  fetchErasureRequests,
  fetchForgetPreview,
  forgetStudent,
  forgetTeacher,
  retryErasureRequests
} from '../../api/userForgettingApi.js';
import UserShowPage from '../UserShowPage.jsx';

vi.mock('../../api/usersApi.js', () => ({
  confirmAccount: vi.fn(),
  deleteAccount: vi.fn(),
  fetchUserById: vi.fn(),
  fetchUsers: vi.fn(),
  impersonateProfessor: vi.fn(),
  triggerPasswordReset: vi.fn(),
  updateUser: vi.fn()
}));

vi.mock('../../api/userForgettingApi.js', () => ({
  forgetStudent: vi.fn(),
  forgetTeacher: vi.fn(),
  fetchForgetPreview: vi.fn(),
  fetchErasureRequests: vi.fn(),
  retryErasureRequests: vi.fn()
}));

vi.mock('../../api/profileApi.js', () => ({
  fetchProfile: vi.fn(async () => ({ id: 1, role: 'S' })),
  fetchPasskeys: vi.fn(async () => ({ passkeys: [] })),
  startPasskeyAuthentication: vi.fn()
}));

const STORED_EMAIL = 'tom.teacher@example.test';

const activeTeacher = Object.freeze({
  id: 31,
  firstname: 'Tom',
  lastname: 'Teacher',
  sex: 'M',
  email: STORED_EMAIL,
  role: 'P',
  active: true,
  emailConfirmed: true,
  status: 'active',
  lastLoginAt: null,
  createdAt: '2026-03-01T12:00:00.000Z'
});

const anonymizedTeacher = Object.freeze({
  ...activeTeacher,
  firstname: 'Former',
  lastname: 'Teacher 31',
  sex: '',
  email: 'anon-teacher-31@anonymous.invalid',
  active: false,
  emailConfirmed: false,
  status: 'anonymized'
});

const PREVIEW = Object.freeze({
  userId: 31,
  openActivities: { ok: true, count: 2 },
  cases: { delete: 3, keep: 4 },
  designs: { delete: 1, keep: 5 },
  activities: 6,
  copiesByOthers: { cases: 7, designs: 8 }
});

const RECIPIENT = Object.freeze({
  id: 40,
  firstname: 'Rita',
  lastname: 'Recipient',
  email: 'rita@example.test',
  role: 'P'
});

let container;
let root;

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderPage() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root.render(
      <AppProviders>
        <MemoryRouter initialEntries={['/users/31']}>
          <Routes>
            <Route path="/users/:id" element={<UserShowPage />} />
          </Routes>
        </MemoryRouter>
      </AppProviders>
    );
  });
  await flush();
}

function setInputValue(input, value) {
  const prototype = input instanceof window.HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
}

async function typeInto(input, value) {
  await act(async () => {
    setInputValue(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}

function byTestId(testId) {
  return document.querySelector(`[data-testid="${testId}"]`);
}

async function openPlan() {
  await click(byTestId('forget-teacher-button'));
  await flush();
}

async function confirmDialogWithPassword() {
  await typeInto(document.querySelector('#sensitive-action-password'), 'admin-secret');
  await click(byTestId('sensitive-action-confirm'));
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(fetchUserById).mockReset().mockResolvedValue({ ...activeTeacher });
  vi.mocked(fetchUsers).mockReset().mockResolvedValue({
    items: [
      { ...activeTeacher },
      { ...RECIPIENT }
    ],
    total: 2
  });
  vi.mocked(fetchForgetPreview).mockReset().mockResolvedValue({ ...PREVIEW });
  vi.mocked(forgetTeacher).mockReset().mockResolvedValue({ id: 31, status: 'anonymized' });
  vi.mocked(forgetStudent).mockReset();
  vi.mocked(fetchErasureRequests).mockReset().mockResolvedValue({
    ok: true,
    requests: [
      { serviceId: 'argumentation-tutor', status: 'done', attempts: 1, lastError: null },
      { serviceId: 'polyadic-agent', status: 'done', attempts: 1, lastError: null }
    ],
    uploadDeletions: { total: 4, pending: 3, retrying: 0, done: 1, skipped: 0, failed: 0, lastError: null }
  });
  vi.mocked(retryErasureRequests).mockReset();
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  document.body.innerHTML = '';
});

describe('UserShowPage: forgetting a teacher', () => {
  it('shows the plan, asks for a danger confirmation, then shows the anonymized account and its erasure', async () => {
    await renderPage();
    expect(byTestId('forget-student-button')).toBeNull();
    expect(container.textContent).toContain('Sign in as professor');

    await openPlan();

    expect(fetchForgetPreview).toHaveBeenCalledWith('31');
    const plan = byTestId('forget-teacher-plan-items');
    expect(byTestId('forget-teacher-plan').textContent).toContain(`Tom Teacher (${STORED_EMAIL})`);
    expect(byTestId('forget-teacher-plan-openActivities').textContent).toBe(
      'Open activities are finished first, with their students notified: 2.'
    );
    expect(byTestId('forget-teacher-plan-casesDeleted').textContent).toContain(': 3.');
    expect(byTestId('forget-teacher-plan-designsDeleted').textContent).toContain(': 1.');
    expect(byTestId('forget-teacher-plan-kept').textContent).toBe(
      'What stays remains under the anonymized account, where nobody can edit it: cases (4), designs (5) and activities (6).'
    );
    expect(byTestId('forget-teacher-plan-copies').textContent).toBe(
      'Copies other teachers made keep working: cases (7) and designs (8).'
    );
    expect(byTestId('forget-teacher-plan-account').textContent).toContain('"Former Teacher 31"');
    expect(plan.querySelectorAll('li')).toHaveLength(7);

    await click(byTestId('forget-teacher-plan-continue'));

    const confirm = byTestId('sensitive-action-confirm');
    expect(byTestId('sensitive-action-form').textContent).toContain('Forget this teacher?');
    expect(byTestId('sensitive-action-form').textContent).toContain('This cannot be undone.');
    const details = [...byTestId('sensitive-action-details').querySelectorAll('li')].map((item) => item.textContent);
    expect(details).toEqual([
      'Open activities finished first: 2.',
      'Deleted: cases (3) and designs (1).',
      'The remaining cases, designs and activities stay under the anonymized account.',
      'The account is disabled and anonymized; the teacher\'s name stays only as the author of their materials.'
    ]);
    expect(confirm.className).toContain('btn-danger');
    expect(confirm.textContent).toBe('Forget teacher');

    vi.mocked(fetchUserById).mockResolvedValue({ ...anonymizedTeacher });
    await confirmDialogWithPassword();

    expect(forgetTeacher).toHaveBeenCalledWith('31', {
      admin_password: 'admin-secret',
      recaptcha_token: '',
      expected_email: STORED_EMAIL,
      recipient_id: null,
      expected_recipient_email: null
    });
    expect(container.querySelector('.alert-success').textContent).toContain('EthicApp forgot Tom Teacher.');
    expect(byTestId('account-status').getAttribute('data-account-status')).toBe('anonymized');
    expect(byTestId('forget-teacher-button')).toBeNull();
    expect(container.textContent).not.toContain('Sign in as professor');
    expect(byTestId('erasure-status-line').textContent).toBe('EthicApp ✓ · Tutor ✓ · Polyadic ✓ · Files: pending');
    expect(byTestId('erasure-files-summary').textContent).toContain('1 of 4 deleted, 0 kept');
    expect(byTestId('erasure-retry-button')).not.toBeNull();
  });

  it('gives the materials to a chosen recipient, warning that they will see the students\' data', async () => {
    await renderPage();
    await openPlan();

    await typeInto(document.querySelector('#forget-teacher-recipient-search'), 'rita');
    await click(byTestId('forget-teacher-recipient-search'));

    expect(fetchUsers).toHaveBeenCalledWith({ keywords: 'rita', role: 'P', status: 'active' });
    // The teacher being forgotten is never offered.
    expect(byTestId('forget-teacher-recipient-choose-31')).toBeNull();
    await click(byTestId('forget-teacher-recipient-choose-40'));

    expect(byTestId('forget-teacher-recipient-selected').textContent).toContain('Rita Recipient (rita@example.test)');
    expect(byTestId('forget-teacher-recipient-warning').textContent).toBe(
      'Rita Recipient will own the activities and will see their students\' names and responses.'
    );
    expect(byTestId('forget-teacher-plan-kept').textContent).toBe(
      'What stays goes to Rita Recipient: cases (4), designs (5) and activities (6).'
    );

    await click(byTestId('forget-teacher-plan-continue'));
    const details = [...byTestId('sensitive-action-details').querySelectorAll('li')].map((item) => item.textContent);
    expect(details[2]).toBe('The remaining cases, designs and activities go to Rita Recipient (rita@example.test).');

    await confirmDialogWithPassword();

    expect(forgetTeacher).toHaveBeenCalledWith('31', expect.objectContaining({
      expected_email: STORED_EMAIL,
      recipient_id: 40,
      expected_recipient_email: 'rita@example.test'
    }));
  });

  it('warns when EthicApp cannot finish the open activities, and reports the refusal without reloading', async () => {
    vi.mocked(fetchForgetPreview).mockResolvedValue({
      ...PREVIEW,
      openActivities: { ok: false, error: 'unreachable', count: 2 }
    });
    vi.mocked(forgetTeacher).mockRejectedValue(Object.assign(new Error('ACTIVITIES_NOT_FINISHED'), {
      code: 'ACTIVITIES_NOT_FINISHED'
    }));
    await renderPage();
    await openPlan();

    const item = byTestId('forget-teacher-plan-openActivities');
    expect(item.textContent).toContain('EthicApp could not be reached to finish them');
    expect(item.className).toContain('text-warning-emphasis');

    await click(byTestId('forget-teacher-plan-continue'));
    await confirmDialogWithPassword();

    expect(container.querySelector('.alert-danger').textContent).toBe(
      'EthicApp could not finish the teacher\'s open activities, so nothing was anonymized. Try again later.'
    );
    expect(fetchUserById).toHaveBeenCalledTimes(1);
  });

  it('reloads the account when it changed meanwhile', async () => {
    vi.mocked(forgetTeacher).mockRejectedValue(
      Object.assign(new Error('ACCOUNT_CHANGED'), { code: 'ACCOUNT_CHANGED' })
    );
    await renderPage();
    await openPlan();
    await click(byTestId('forget-teacher-plan-continue'));
    await confirmDialogWithPassword();

    expect(container.querySelector('.alert-danger').textContent).toContain(
      'The email of this account changed since the page was loaded, so it was not forgotten.'
    );
    expect(fetchUserById).toHaveBeenCalledTimes(2);
  });

  it('cannot forget a teacher while the form has unsaved edits', async () => {
    await renderPage();
    const button = byTestId('forget-teacher-button');

    await typeInto(container.querySelector('input[type="email"]'), 'edited@example.test');

    expect(button.disabled).toBe(true);
    const hint = byTestId('unsaved-changes-hint');
    expect(hint.textContent).toBe('Save or discard your changes before setting the password of or forgetting this account.');
    expect(button.getAttribute('aria-describedby')).toBe(hint.id);
    await click(button);
    expect(fetchForgetPreview).not.toHaveBeenCalled();

    await click(byTestId('discard-changes-button'));
    expect(button.disabled).toBe(false);
  });

  it('says when the plan cannot be loaded, and offers no way forward', async () => {
    vi.mocked(fetchForgetPreview).mockRejectedValue(Object.assign(new Error('Request failed'), { code: 'x' }));
    await renderPage();
    await openPlan();

    expect(byTestId('forget-teacher-plan-error')).not.toBeNull();
    expect(byTestId('forget-teacher-plan-continue').disabled).toBe(true);
  });
});

describe('UserShowPage: forgetting a teacher in Spanish', () => {
  it('shows the plan and the confirmation in es-CL', async () => {
    const languages = vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['es-CL']);
    const language = vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('es-CL');

    try {
      await renderPage();
      expect(byTestId('forget-teacher-button').textContent).toBe('Olvidar a este docente');

      await openPlan();
      expect(byTestId('forget-teacher-plan-openActivities').textContent).toBe(
        'Primero se finalizan las actividades abiertas, con aviso a sus estudiantes: 2.'
      );
      await click(byTestId('forget-teacher-plan-continue'));
      expect(byTestId('sensitive-action-confirm').textContent).toBe('Olvidar docente');
    } finally {
      languages.mockRestore();
      language.mockRestore();
    }
  });
});
