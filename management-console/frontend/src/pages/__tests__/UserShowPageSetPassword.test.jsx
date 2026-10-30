// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../app/providers.jsx';
import { fetchUserById } from '../../api/usersApi.js';
import { fetchPasswordPolicy, setUserPassword } from '../../api/userPasswordApi.js';
import UserShowPage from '../UserShowPage.jsx';

vi.mock('../../api/usersApi.js', () => ({
  confirmAccount: vi.fn(),
  deleteAccount: vi.fn(),
  fetchUserById: vi.fn(),
  impersonateProfessor: vi.fn(),
  triggerPasswordReset: vi.fn(),
  updateUser: vi.fn()
}));

vi.mock('../../api/userPasswordApi.js', () => ({
  fetchPasswordPolicy: vi.fn(),
  setUserPassword: vi.fn()
}));

vi.mock('../../api/userForgettingApi.js', () => ({
  forgetStudent: vi.fn(),
  fetchErasureRequests: vi.fn(async () => ({ ok: true, requests: [] })),
  retryErasureRequests: vi.fn()
}));

vi.mock('../../api/profileApi.js', () => ({
  fetchProfile: vi.fn(async () => ({ id: 1, role: 'S' })),
  fetchPasskeys: vi.fn(async () => ({ passkeys: [] })),
  startPasskeyAuthentication: vi.fn()
}));

const STORED_EMAIL = 'pat.teacher@example.test';
const NEW_PASSWORD = 'Temporary-Pass!42';

const activeTeacher = Object.freeze({
  id: 22,
  firstname: 'Pat',
  lastname: 'Teacher',
  sex: 'O',
  email: STORED_EMAIL,
  role: 'P',
  active: true,
  emailConfirmed: true,
  status: 'active',
  lastLoginAt: '2026-10-01T12:00:00.000Z',
  createdAt: '2026-03-01T12:00:00.000Z'
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

function passwordDialog() {
  return byTestId('set-password-dialog');
}

function newPasswordInput() {
  return document.querySelector('#set-password-new');
}

function confirmationInput() {
  return document.querySelector('#set-password-confirmation');
}

async function fillPasswords(password, confirmation = password) {
  await typeInto(newPasswordInput(), password);
  await typeInto(confirmationInput(), confirmation);
}

async function confirmStepUp() {
  await typeInto(document.querySelector('#sensitive-action-password'), 'admin-secret');
  await click(byTestId('sensitive-action-confirm'));
}

function ruleStates() {
  return [...byTestId('password-rules').querySelectorAll('li')].map((item) => item.dataset.met === 'true');
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(fetchUserById).mockReset().mockResolvedValue({ ...activeTeacher });
  vi.mocked(fetchPasswordPolicy).mockReset().mockResolvedValue({ minLength: 10, minSymbols: 2 });
  vi.mocked(setUserPassword).mockReset().mockResolvedValue({ id: 22, message: 'Password set.' });
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('UserShowPage: setting a password (#889)', () => {
  it('collects the password with a live checklist, asks for the step-up and reports success', async () => {
    await renderPage();
    expect(fetchPasswordPolicy).not.toHaveBeenCalled();

    await click(byTestId('set-password-button'));

    expect(fetchPasswordPolicy).toHaveBeenCalledTimes(1);
    const dialog = passwordDialog();
    expect(dialog.textContent).toContain('Set a password for Pat Teacher');
    expect(dialog.textContent).toContain(`Pat Teacher (${STORED_EMAIL})`);
    expect(byTestId('set-password-notes').textContent).toContain('Every open session of this user ends at once.');
    expect(byTestId('set-password-notes').textContent).toContain('Give the password to the user in person.');
    expect(newPasswordInput().getAttribute('autocomplete')).toBe('new-password');
    expect(confirmationInput().getAttribute('autocomplete')).toBe('new-password');
    expect(newPasswordInput().type).toBe('password');

    // The checklist comes from the policy endpoint.
    expect(dialog.textContent).toContain('At least 10 characters');
    expect(dialog.textContent).toContain('At least 2 symbols');
    expect(ruleStates()).toEqual([false, false, false]);
    expect(byTestId('set-password-continue').disabled).toBe(true);

    await typeInto(newPasswordInput(), 'abcdefghij!');
    expect(ruleStates()).toEqual([true, false, false]);
    expect(byTestId('set-password-continue').disabled).toBe(true);

    await fillPasswords(NEW_PASSWORD, `${NEW_PASSWORD}x`);
    expect(ruleStates()).toEqual([true, true, false]);
    expect(byTestId('set-password-continue').disabled).toBe(true);

    await typeInto(confirmationInput(), NEW_PASSWORD);
    expect(ruleStates()).toEqual([true, true, true]);

    await click(byTestId('set-password-visibility'));
    expect(newPasswordInput().type).toBe('text');
    expect(confirmationInput().type).toBe('text');
    await click(byTestId('set-password-visibility'));
    expect(newPasswordInput().type).toBe('password');

    await click(byTestId('set-password-continue'));

    const stepUp = byTestId('sensitive-action-modal');
    expect(stepUp.textContent).toContain('Set this password?');
    expect(stepUp.textContent).toContain(`The password of Pat Teacher (${STORED_EMAIL}) will be replaced.`);
    expect(byTestId('sensitive-action-details').textContent).toContain('Every open session of this user ends at once.');

    await confirmStepUp();

    expect(setUserPassword).toHaveBeenCalledWith('22', {
      admin_password: 'admin-secret',
      recaptcha_token: '',
      new_password: NEW_PASSWORD,
      password_confirmation: NEW_PASSWORD,
      expected_email: STORED_EMAIL
    });
    expect(container.querySelector('.alert-success').textContent).toContain(
      'The password of Pat Teacher was set and their open sessions were closed.'
    );
    expect(container.textContent).not.toContain(NEW_PASSWORD);

    // Opening the dialog again starts empty.
    await click(byTestId('set-password-button'));
    expect(newPasswordInput().value).toBe('');
    expect(confirmationInput().value).toBe('');
    expect(fetchPasswordPolicy).toHaveBeenCalledTimes(1);
  });

  it("reopens the dialog with auth-backend's message when it refuses the password", async () => {
    const message = 'Password must be at least 10 characters long and contain at least 2 symbols';
    vi.mocked(setUserPassword).mockRejectedValue(
      Object.assign(new Error('WEAK_PASSWORD'), { code: 'WEAK_PASSWORD', body: { error: 'WEAK_PASSWORD', message } })
    );
    // Without the policy there is no checklist, and auth-backend decides.
    vi.mocked(fetchPasswordPolicy).mockRejectedValue(new Error('PASSWORD_POLICY_UNAVAILABLE'));
    await renderPage();

    await click(byTestId('set-password-button'));
    expect(byTestId('password-rules')).toBeNull();
    await fillPasswords('short');
    await click(byTestId('set-password-continue'));
    await confirmStepUp();

    expect(setUserPassword).toHaveBeenCalledTimes(1);
    expect(byTestId('set-password-error').textContent).toBe(message);
    expect(newPasswordInput().value).toBe('short');
    expect(container.querySelector('.alert-danger')).toBeNull();
  });

  it('goes back to the typed password when the step-up is cancelled', async () => {
    await renderPage();

    await click(byTestId('set-password-button'));
    await fillPasswords(NEW_PASSWORD);
    await click(byTestId('set-password-continue'));
    await click(byTestId('sensitive-action-cancel'));

    expect(setUserPassword).not.toHaveBeenCalled();
    expect(newPasswordInput().value).toBe(NEW_PASSWORD);

    await click(byTestId('set-password-cancel'));
    await click(byTestId('set-password-button'));
    expect(newPasswordInput().value).toBe('');
  });

  it('reports an account whose email changed meanwhile and shows the current account', async () => {
    vi.mocked(setUserPassword).mockRejectedValue(
      Object.assign(new Error('ACCOUNT_CHANGED'), {
        code: 'ACCOUNT_CHANGED',
        body: { error: 'ACCOUNT_CHANGED', message: 'The account changed' }
      })
    );
    await renderPage();
    vi.mocked(fetchUserById).mockResolvedValue({ ...activeTeacher, email: 'changed@example.test' });

    await click(byTestId('set-password-button'));
    await fillPasswords(NEW_PASSWORD);
    await click(byTestId('set-password-continue'));
    await confirmStepUp();

    expect(container.querySelector('.alert-danger').textContent).toContain(
      'The email of this account changed since the page was loaded, so the password was not set.'
    );
    expect(container.querySelector('input[type="email"]').value).toBe('changed@example.test');
  });

  it('is disabled while the form has unsaved edits', async () => {
    await renderPage();
    const button = byTestId('set-password-button');
    expect(button.disabled).toBe(false);

    await typeInto(container.querySelector('input[type="email"]'), 'edited@example.test');

    expect(button.disabled).toBe(true);
    const hint = byTestId('unsaved-changes-hint');
    expect(hint.textContent).toBe('Save or discard your changes before setting the password of this account.');
    expect(button.getAttribute('aria-describedby')).toBe(hint.id);
    await click(button);
    expect(passwordDialog()).toBeNull();

    await click(byTestId('discard-changes-button'));
    expect(button.disabled).toBe(false);
  });

  it('is not offered for administrator or anonymized accounts', async () => {
    vi.mocked(fetchUserById).mockResolvedValue({ ...activeTeacher, id: 5, role: 'S' });
    await renderPage();
    expect(byTestId('set-password-button')).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();

    vi.mocked(fetchUserById).mockResolvedValue({ ...activeTeacher, role: 'A', status: 'anonymized', active: false });
    await renderPage();
    expect(byTestId('set-password-button')).toBeNull();
  });

  it('speaks Spanish to a Spanish-speaking administrator', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['es-CL', 'es']);
    await renderPage();

    const button = byTestId('set-password-button');
    expect(button.textContent).toContain('Establecer contraseña');
    await click(button);

    const dialog = passwordDialog();
    expect(dialog.textContent).toContain('Establecer una contraseña para Pat Teacher');
    expect(dialog.textContent).toContain('Al menos 10 caracteres');
    expect(dialog.textContent).toContain('Al menos 2 símbolos');
    expect(dialog.textContent).toContain('La confirmación coincide');
    expect(byTestId('set-password-notes').textContent).toContain('Entrega la contraseña al usuario en persona.');
  });
});
