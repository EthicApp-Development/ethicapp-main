// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../app/providers.jsx';
import { confirmAccount, fetchUserById, updateUser } from '../../api/usersApi.js';
import UserShowPage from '../UserShowPage.jsx';

vi.mock('../../api/usersApi.js', () => ({
  confirmAccount: vi.fn(),
  deleteAccount: vi.fn(),
  fetchUserById: vi.fn(),
  impersonateProfessor: vi.fn(),
  triggerPasswordReset: vi.fn(),
  updateUser: vi.fn()
}));

vi.mock('../../api/profileApi.js', () => ({
  fetchProfile: vi.fn(async () => ({ id: 1, role: 'S' })),
  fetchPasskeys: vi.fn(async () => ({ passkeys: [] })),
  startPasskeyAuthentication: vi.fn()
}));

const STORED_EMAIL = 'stored@example.test';
const EDITED_EMAIL = 'edited-but-unsaved@example.test';

const pendingUser = Object.freeze({
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
  createdAt: '2026-10-29T15:30:00.000Z'
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

function emailInput() {
  return container.querySelector('input[type="email"]');
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
  vi.mocked(fetchUserById).mockReset().mockResolvedValue({ ...pendingUser });
  vi.mocked(confirmAccount).mockReset().mockResolvedValue({ id: 22, status: 'active' });
  vi.mocked(updateUser).mockReset();
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  document.body.innerHTML = '';
});

describe('UserShowPage: confirming a pending account', () => {
  it('cannot confirm while the email is edited and not saved, and discarding restores the stored email', async () => {
    await renderPage();
    const button = byTestId('confirm-account-button');
    expect(button.disabled).toBe(false);
    expect(byTestId('unsaved-changes-hint')).toBeNull();

    await typeInto(emailInput(), EDITED_EMAIL);

    expect(button.disabled).toBe(true);
    const hint = byTestId('unsaved-changes-hint');
    expect(hint.textContent).toBe('Save or discard your changes before confirming, setting the password of, deleting or forgetting this account.');
    expect(button.getAttribute('aria-describedby')).toBe(hint.id);

    await click(button);
    expect(document.querySelector('.modal')).toBeNull();

    await click(byTestId('discard-changes-button'));

    expect(emailInput().value).toBe(STORED_EMAIL);
    expect(button.disabled).toBe(false);
    expect(byTestId('unsaved-changes-hint')).toBeNull();

    await click(button);
    expect(dialogText()).toContain(STORED_EMAIL);
    expect(dialogText()).not.toContain(EDITED_EMAIL);

    await confirmDialogWithPassword();

    expect(confirmAccount).toHaveBeenCalledWith('22', {
      admin_password: 'admin-secret',
      recaptcha_token: '',
      expected_email: STORED_EMAIL
    });
    expect(byTestId('account-status').getAttribute('data-account-status')).toBe('pending');
    expect(fetchUserById).toHaveBeenCalledTimes(2);
  });

  it('names the saved email in the dialog once the edit is saved', async () => {
    const savedEmail = 'saved@example.test';
    vi.mocked(updateUser).mockResolvedValue({});
    await renderPage();

    await typeInto(emailInput(), savedEmail);
    await typeInto(container.querySelectorAll('input[type="email"]')[1], savedEmail);
    vi.mocked(fetchUserById).mockResolvedValue({ ...pendingUser, email: savedEmail });

    await act(async () => {
      container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
    await confirmDialogWithPassword();

    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(byTestId('confirm-account-button').disabled).toBe(false);
    expect(byTestId('unsaved-changes-hint')).toBeNull();

    await click(byTestId('confirm-account-button'));
    expect(dialogText()).toContain(savedEmail);
    expect(dialogText()).not.toContain(STORED_EMAIL);

    await confirmDialogWithPassword();
    expect(confirmAccount).toHaveBeenCalledWith('22', expect.objectContaining({ expected_email: savedEmail }));
  });

  it('reports an account whose email changed meanwhile and shows the current account', async () => {
    vi.mocked(confirmAccount).mockRejectedValue(
      Object.assign(new Error('ACCOUNT_CHANGED'), { code: 'ACCOUNT_CHANGED' })
    );
    await renderPage();
    vi.mocked(fetchUserById).mockResolvedValue({ ...pendingUser, email: 'changed@example.test' });

    await click(byTestId('confirm-account-button'));
    await confirmDialogWithPassword();

    expect(container.querySelector('.alert-danger').textContent).toContain(
      'The email of this account changed since the page was loaded'
    );
    expect(emailInput().value).toBe('changed@example.test');
  });
});

describe('UserShowPage: account creation date', () => {
  it('shows the stored creation date, which is not an unsaved edit', async () => {
    await renderPage();

    expect(byTestId('user-created-at').value).toBe(
      new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' })
        .format(new Date(pendingUser.createdAt))
    );
    expect(byTestId('confirm-account-button').disabled).toBe(false);
    expect(byTestId('unsaved-changes-hint')).toBeNull();
  });

  it('shows an unknown creation date for an account created before it was recorded', async () => {
    vi.mocked(fetchUserById).mockResolvedValue({ ...pendingUser, createdAt: null });
    await renderPage();

    expect(byTestId('user-created-at').value).toBe('Unknown (not recorded)');
    expect(byTestId('confirm-account-button').disabled).toBe(false);
  });
});
