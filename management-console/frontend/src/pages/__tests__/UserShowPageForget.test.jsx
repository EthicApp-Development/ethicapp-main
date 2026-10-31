// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../app/providers.jsx';
import { fetchUserById } from '../../api/usersApi.js';
import {
  fetchErasureRequests,
  forgetStudent,
  retryErasureRequests
} from '../../api/userForgettingApi.js';
import UserShowPage from '../UserShowPage.jsx';

vi.mock('../../api/usersApi.js', () => ({
  confirmAccount: vi.fn(),
  deleteAccount: vi.fn(),
  fetchUserById: vi.fn(),
  impersonateProfessor: vi.fn(),
  triggerPasswordReset: vi.fn(),
  updateUser: vi.fn()
}));

vi.mock('../../api/userForgettingApi.js', () => ({
  forgetStudent: vi.fn(),
  fetchErasureRequests: vi.fn(),
  retryErasureRequests: vi.fn()
}));

vi.mock('../../api/profileApi.js', () => ({
  fetchProfile: vi.fn(async () => ({ id: 1, role: 'S' })),
  fetchPasskeys: vi.fn(async () => ({ passkeys: [] })),
  startPasskeyAuthentication: vi.fn()
}));

const STORED_EMAIL = 'ana.student@example.test';

const activeStudent = Object.freeze({
  id: 22,
  firstname: 'Ana',
  lastname: 'Student',
  sex: 'F',
  email: STORED_EMAIL,
  role: 'A',
  active: true,
  emailConfirmed: true,
  status: 'active',
  lastLoginAt: null,
  createdAt: '2026-03-01T12:00:00.000Z'
});

const anonymizedStudent = Object.freeze({
  ...activeStudent,
  firstname: 'Anonymous',
  lastname: 'Student 22',
  sex: '',
  email: 'anon-student-22@anonymous.invalid',
  active: false,
  emailConfirmed: false,
  status: 'anonymized'
});

const REQUESTS_RETRYING = Object.freeze([
  { serviceId: 'argumentation-tutor', status: 'done', attempts: 1, lastError: null },
  { serviceId: 'polyadic-agent', status: 'pending', attempts: 2, lastError: 'HTTP_503' }
]);

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
        <MemoryRouter initialEntries={['/users/22']}>
          <Routes>
            <Route path="/users/:id" element={<UserShowPage />} />
          </Routes>
        </MemoryRouter>
      </AppProviders>
    );
  });
  await flush();
}

async function typeInto(input, value) {
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setValue.call(input, value);
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

function dialog() {
  return document.querySelector('.modal');
}

async function confirmDialogWithPassword() {
  await typeInto(document.querySelector('#sensitive-action-password'), 'admin-secret');
  await click(byTestId('sensitive-action-confirm'));
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(fetchUserById).mockReset().mockResolvedValue({ ...activeStudent });
  vi.mocked(forgetStudent).mockReset().mockResolvedValue({ id: 22, status: 'anonymized', erasureRequests: [] });
  vi.mocked(fetchErasureRequests).mockReset().mockResolvedValue({ ok: true, requests: REQUESTS_RETRYING });
  vi.mocked(retryErasureRequests).mockReset();
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  document.body.innerHTML = '';
});

describe('UserShowPage: forgetting a student', () => {
  it('asks for a danger confirmation that lists what will happen, then shows the anonymized account', async () => {
    await renderPage();
    expect(byTestId('erasure-status')).toBeNull();

    await click(byTestId('forget-student-button'));

    const confirm = byTestId('sensitive-action-confirm');
    expect(dialog().textContent).toContain('Forget this student?');
    expect(dialog().textContent).toContain(`Ana Student (${STORED_EMAIL})`);
    expect(dialog().textContent).toContain('This cannot be undone.');
    expect(byTestId('sensitive-action-details').querySelectorAll('li')).toHaveLength(4);
    expect(confirm.className).toContain('btn-danger');
    expect(confirm.textContent).toBe('Forget student');

    vi.mocked(fetchUserById).mockResolvedValue({ ...anonymizedStudent });
    await confirmDialogWithPassword();

    expect(forgetStudent).toHaveBeenCalledWith('22', {
      admin_password: 'admin-secret',
      recaptcha_token: '',
      expected_email: STORED_EMAIL
    });
    expect(container.querySelector('.alert-success').textContent).toContain('EthicApp forgot Ana Student.');
    expect(byTestId('account-status').getAttribute('data-account-status')).toBe('anonymized');
    expect(byTestId('forget-student-button')).toBeNull();
    expect(container.querySelector('fieldset').disabled).toBe(true);
    expect(container.querySelector('button[type="submit"]')).toBeNull();
    expect(byTestId('erasure-status-line').textContent).toBe('EthicApp ✓ · Tutor ✓ · Polyadic: retrying');
  });

  it('cannot forget an active student while the form has unsaved edits, until they are discarded', async () => {
    await renderPage();
    const button = byTestId('forget-student-button');
    expect(byTestId('discard-changes-button')).toBeNull();

    await typeInto(container.querySelector('input[type="email"]'), 'edited@example.test');

    expect(button.disabled).toBe(true);
    const hint = byTestId('unsaved-changes-hint');
    expect(hint.textContent).toBe('Save or discard your changes before setting the password of or forgetting this account.');
    expect(button.getAttribute('aria-describedby')).toBe(hint.id);
    await click(button);
    expect(dialog()).toBeNull();
    expect(forgetStudent).not.toHaveBeenCalled();

    // An active account has no confirm or delete action, but its edits can
    // still be discarded, so the hint is actionable.
    await click(byTestId('discard-changes-button'));

    expect(container.querySelector('input[type="email"]').value).toBe(STORED_EMAIL);
    expect(button.disabled).toBe(false);
    expect(byTestId('unsaved-changes-hint')).toBeNull();
    expect(byTestId('discard-changes-button')).toBeNull();

    await click(button);
    expect(dialog().textContent).toContain(STORED_EMAIL);
  });

  it('offers to discard the edits of an account with no action that needs it, without a hint', async () => {
    // An administrator account cannot be confirmed, deleted, forgotten or given a password.
    vi.mocked(fetchUserById).mockResolvedValue({ ...activeStudent, role: 'S' });
    await renderPage();

    await typeInto(container.querySelector('input[type="email"]'), 'edited@example.test');

    expect(byTestId('unsaved-changes-hint')).toBeNull();
    await click(byTestId('discard-changes-button'));
    expect(container.querySelector('input[type="email"]').value).toBe(STORED_EMAIL);
  });

  it('reports a refusal and reloads the account', async () => {
    vi.mocked(forgetStudent).mockRejectedValue(
      Object.assign(new Error('ACCOUNT_CHANGED'), { code: 'ACCOUNT_CHANGED' })
    );
    await renderPage();

    await click(byTestId('forget-student-button'));
    await confirmDialogWithPassword();

    expect(container.querySelector('.alert-danger').textContent).toContain(
      'The email of this account changed since the page was loaded, so it was not forgotten.'
    );
    expect(fetchUserById).toHaveBeenCalledTimes(2);
  });

  it('is not offered for teachers', async () => {
    vi.mocked(fetchUserById).mockResolvedValue({ ...activeStudent, role: 'P' });
    await renderPage();

    expect(byTestId('forget-student-button')).toBeNull();
  });
});

describe('UserShowPage: erasure status of a forgotten student', () => {
  it('shows each service and retries the ones that are not done', async () => {
    vi.mocked(fetchUserById).mockResolvedValue({ ...anonymizedStudent });
    vi.mocked(retryErasureRequests).mockResolvedValue({
      ok: true,
      requests: [
        REQUESTS_RETRYING[0],
        { serviceId: 'polyadic-agent', status: 'done', attempts: 1, lastError: null }
      ]
    });
    await renderPage();

    expect(byTestId('erasure-status-polyadic-agent').getAttribute('data-erasure-status')).toBe('retrying');
    expect(byTestId('erasure-last-error-polyadic-agent').textContent).toBe('Polyadic: Last error: HTTP_503');

    await click(byTestId('erasure-retry-button'));

    expect(retryErasureRequests).toHaveBeenCalledWith('22');
    expect(byTestId('erasure-status-line').textContent).toBe('EthicApp ✓ · Tutor ✓ · Polyadic ✓');
    expect(byTestId('erasure-retry-button')).toBeNull();
  });

  it('shows a failed request and says when EthicApp cannot tell', async () => {
    vi.mocked(fetchUserById).mockResolvedValue({ ...anonymizedStudent });
    vi.mocked(fetchErasureRequests).mockResolvedValue({ ok: false, error: 'unreachable' });
    await renderPage();

    expect(byTestId('erasure-status-unavailable')).not.toBeNull();
    expect(byTestId('erasure-status-line').textContent).toBe('EthicApp ✓');
    expect(byTestId('erasure-retry-button')).toBeNull();
  });

  it('reports a retry that EthicApp could not take', async () => {
    vi.mocked(fetchUserById).mockResolvedValue({ ...anonymizedStudent });
    vi.mocked(fetchErasureRequests).mockResolvedValue({
      ok: true,
      requests: [{ serviceId: 'argumentation-tutor', status: 'failed', attempts: 1, lastError: 'HTTP_400' }]
    });
    vi.mocked(retryErasureRequests).mockResolvedValue({ ok: false, error: 'unreachable' });
    await renderPage();

    expect(byTestId('erasure-status-line').textContent).toBe('EthicApp ✓ · Tutor: failed');
    await click(byTestId('erasure-retry-button'));

    expect(byTestId('erasure-retry-error').textContent).toContain('Unable to retry the erasure now');
    expect(byTestId('erasure-status-line').textContent).toBe('EthicApp ✓ · Tutor: failed');
  });

  it('explains an account anonymized before erasure requests existed', async () => {
    vi.mocked(fetchUserById).mockResolvedValue({ ...anonymizedStudent });
    vi.mocked(fetchErasureRequests).mockResolvedValue({ ok: true, requests: [] });
    await renderPage();

    expect(byTestId('erasure-status-none')).not.toBeNull();
    expect(byTestId('erasure-retry-button')).toBeNull();
  });
});
