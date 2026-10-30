// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../app/providers.jsx';
import { deleteAccount, fetchUserById, fetchUsers } from '../../api/usersApi.js';
import UserShowPage from '../UserShowPage.jsx';
import UsersPage from '../UsersPage.jsx';

vi.mock('../../api/usersApi.js', () => ({
  confirmAccount: vi.fn(),
  deleteAccount: vi.fn(),
  fetchUserById: vi.fn(),
  fetchUsers: vi.fn(),
  impersonateProfessor: vi.fn(),
  triggerPasswordReset: vi.fn(),
  updateUser: vi.fn()
}));

vi.mock('../../api/profileApi.js', () => ({
  fetchProfile: vi.fn(async () => ({ id: 1, role: 'S' })),
  fetchPasskeys: vi.fn(async () => ({ passkeys: [] })),
  startPasskeyAuthentication: vi.fn()
}));

const DAY = 24 * 60 * 60 * 1000;
const STORED_EMAIL = 'stored@example.test';
const EDITED_EMAIL = 'edited-but-unsaved@example.test';
const CREATED_AT = new Date(Date.now() - 3 * DAY - 60 * 1000).toISOString();

const neverActivatedUser = Object.freeze({
  id: 22,
  firstname: 'Pat',
  lastname: 'Student',
  sex: 'O',
  email: STORED_EMAIL,
  role: 'A',
  active: false,
  emailConfirmed: false,
  status: 'pending',
  lastLoginAt: null,
  createdAt: CREATED_AT
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
        <MemoryRouter initialEntries={['/users/22']}>
          <Routes>
            <Route path="/users" element={<UsersPage />} />
            <Route path="/users/:id" element={<UserShowPage />} />
          </Routes>
        </MemoryRouter>
      </AppProviders>
    );
  });
  await flush();
}

// Types into a controlled input the way a browser does, so React sees it.
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

function dialogText() {
  return document.querySelector('.modal')?.textContent || '';
}

async function confirmDialogWithPassword() {
  await typeInto(document.querySelector('#sensitive-action-password'), 'admin-secret');
  await click(byTestId('sensitive-action-confirm'));
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(fetchUserById).mockReset().mockResolvedValue({ ...neverActivatedUser });
  vi.mocked(fetchUsers).mockReset().mockResolvedValue({ items: [], page: 1, totalPages: 1, total: 0 });
  vi.mocked(deleteAccount).mockReset().mockResolvedValue({ id: 22, deleted: true });
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  document.body.innerHTML = '';
});

describe('UserShowPage: deleting a never-activated account', () => {
  for (const [label, user] of [
    ['an active account', { status: 'active', active: true, emailConfirmed: true }],
    ['an account deactivated by an administrator', { status: 'inactive', emailConfirmed: true }],
    ['an anonymized account', { status: 'anonymized' }],
    ['a pending account whose owner signed in once', { lastLoginAt: '2026-10-01T10:00:00.000Z' }]
  ]) {
    it(`is not offered for ${label}`, async () => {
      vi.mocked(fetchUserById).mockResolvedValue({ ...neverActivatedUser, ...user });
      await renderPage();

      expect(byTestId('delete-account-button')).toBeNull();
    });
  }

  it('asks for the step-up confirmation in a danger dialog that names the account and its age, then returns to the list', async () => {
    await renderPage();
    const button = byTestId('delete-account-button');
    expect(button.disabled).toBe(false);

    await click(button);

    const text = dialogText();
    expect(text).toContain('Delete this account?');
    expect(text).toContain(`The account of Pat Student (${STORED_EMAIL}) will be deleted permanently.`);
    expect(text).toContain('This cannot be undone.');
    expect(text).toContain('The account was created 3 days ago (');
    expect(text).toContain('and was never activated.');
    expect(byTestId('sensitive-action-confirm').className).toContain('btn-danger');
    expect(byTestId('sensitive-action-confirm').textContent).toBe('Delete account');

    await confirmDialogWithPassword();

    expect(deleteAccount).toHaveBeenCalledWith('22', {
      admin_password: 'admin-secret',
      recaptcha_token: '',
      expected_email: STORED_EMAIL
    });
    expect(byTestId('delete-account-button')).toBeNull();
    expect(byTestId('account-deleted-notice').textContent).toContain(
      'The account was deleted. Its email can be used to sign up again.'
    );
    expect(fetchUsers).toHaveBeenCalled();
  });

  it('says the age is unknown for an account created before creation dates were recorded', async () => {
    vi.mocked(fetchUserById).mockResolvedValue({ ...neverActivatedUser, createdAt: null });
    await renderPage();

    await click(byTestId('delete-account-button'));

    expect(dialogText()).toContain(
      'How long the account has been pending is unknown: it was created before creation dates were recorded.'
    );
  });

  it('cannot delete while the form has unsaved edits, and the dialog names the stored email after discarding them', async () => {
    await renderPage();
    const button = byTestId('delete-account-button');

    await typeInto(container.querySelector('input[type="email"]'), EDITED_EMAIL);

    expect(button.disabled).toBe(true);
    const hint = byTestId('confirm-account-unsaved-hint');
    expect(hint.textContent).toBe('Save or discard your changes before confirming or deleting the account.');
    expect(button.getAttribute('aria-describedby')).toBe(hint.id);

    await click(button);
    expect(document.querySelector('.modal')).toBeNull();

    await click(byTestId('discard-changes-button'));
    expect(button.disabled).toBe(false);

    await click(button);
    expect(dialogText()).toContain(STORED_EMAIL);
    expect(dialogText()).not.toContain(EDITED_EMAIL);
  });

  it('reports the data that keeps an account from being deleted and stays on the page', async () => {
    vi.mocked(deleteAccount).mockRejectedValue(Object.assign(new Error('ACCOUNT_REFERENCED'), {
      code: 'ACCOUNT_REFERENCED',
      body: { error: 'ACCOUNT_REFERENCED', referenced_by: 'sesusers', reference_category: 'activities' }
    }));
    await renderPage();

    await click(byTestId('delete-account-button'));
    await confirmDialogWithPassword();

    expect(container.querySelector('.alert-danger').textContent).toBe(
      'This account has activity participations (table sesusers), so it was not deleted.'
    );
    expect(byTestId('delete-account-button')).not.toBeNull();
    expect(fetchUserById).toHaveBeenCalledTimes(2);
  });

  it('reports an account that is no longer deletable and shows its current status', async () => {
    vi.mocked(deleteAccount).mockRejectedValue(Object.assign(new Error('ACCOUNT_NOT_DELETABLE'), {
      code: 'ACCOUNT_NOT_DELETABLE',
      body: { error: 'ACCOUNT_NOT_DELETABLE', status: 'active' }
    }));
    await renderPage();
    vi.mocked(fetchUserById).mockResolvedValue({
      ...neverActivatedUser,
      status: 'active',
      active: true,
      emailConfirmed: true
    });

    await click(byTestId('delete-account-button'));
    await confirmDialogWithPassword();

    expect(container.querySelector('.alert-danger').textContent).toContain(
      'Only accounts that were never activated can be deleted'
    );
    expect(byTestId('account-status').getAttribute('data-account-status')).toBe('active');
    expect(byTestId('delete-account-button')).toBeNull();
  });
});
