// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../app/providers.jsx';
import { createUserAccount } from '../../api/userAccountApi.js';
import { fetchPasswordPolicy } from '../../api/userPasswordApi.js';
import UserCreatePage from '../UserCreatePage.jsx';

vi.mock('../../api/userAccountApi.js', () => ({
  createUserAccount: vi.fn()
}));

vi.mock('../../api/userPasswordApi.js', () => ({
  fetchPasswordPolicy: vi.fn(),
  setUserPassword: vi.fn()
}));

vi.mock('../../api/profileApi.js', () => ({
  fetchProfile: vi.fn(async () => ({ id: 1, role: 'S' })),
  fetchPasskeys: vi.fn(async () => ({ passkeys: [] })),
  startPasskeyAuthentication: vi.fn()
}));

const PASSWORD = 'Temporary-Pass!42';

let container;
let root;

// Stands in for the account page: shows where the creation page went, and
// with which state.
function CreatedAccount() {
  const { id } = useParams();
  const location = useLocation();
  return <div data-testid="created-account">{JSON.stringify({ id, state: location.state })}</div>;
}

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
        <MemoryRouter initialEntries={['/users/new']}>
          <Routes>
            <Route path="/users/new" element={<UserCreatePage />} />
            <Route path="/users/:id" element={<CreatedAccount />} />
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

async function choose(select, value) {
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  await act(async () => {
    setValue.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
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

async function fillAccount({ password = PASSWORD } = {}) {
  await typeInto(document.querySelector('#create-account-firstname'), 'Ana');
  await typeInto(document.querySelector('#create-account-lastname'), 'Rojas');
  await typeInto(document.querySelector('#create-account-email'), 'ana.rojas@example.test');
  await choose(document.querySelector('#create-account-gender'), 'F');
  await choose(document.querySelector('#create-account-role'), 'P');
  if (password) {
    await typeInto(byTestId('create-account-password'), password);
    await typeInto(byTestId('create-account-password-confirmation'), password);
  }
}

async function confirmPrivacyNotice() {
  await click(byTestId('create-account-privacy-notice'));
}

async function confirmStepUp() {
  await typeInto(document.querySelector('#sensitive-action-password'), 'admin-secret');
  await click(byTestId('sensitive-action-confirm'));
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(fetchPasswordPolicy).mockReset().mockResolvedValue({ minLength: 10, minSymbols: 2 });
  vi.mocked(createUserAccount).mockReset().mockResolvedValue({
    id: 314,
    message: 'Account created.',
    welcome_email_sent: true
  });
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  document.body.innerHTML = '';
});

describe('UserCreatePage (#1170)', () => {
  it('creates the account after the privacy confirmation and the step-up, then opens it', async () => {
    await renderPage();
    await fillAccount();

    expect(byTestId('create-account-submit').disabled).toBe(true);
    await confirmPrivacyNotice();
    expect(byTestId('create-account-submit').disabled).toBe(false);

    await click(byTestId('create-account-submit'));
    expect(createUserAccount).not.toHaveBeenCalled();
    expect(byTestId('sensitive-action-modal').textContent).toContain('Ana Rojas (ana.rojas@example.test)');

    await confirmStepUp();

    expect(createUserAccount).toHaveBeenCalledTimes(1);
    expect(createUserAccount).toHaveBeenCalledWith(expect.objectContaining({
      admin_password: 'admin-secret',
      firstname: 'Ana',
      lastname: 'Rojas',
      email: 'ana.rojas@example.test',
      gender: 'F',
      role: 'P',
      preferred_locale: 'en_US',
      password: PASSWORD,
      password_confirmation: PASSWORD,
      privacy_notice_confirmed: true
    }));
    expect(JSON.parse(byTestId('created-account').textContent)).toEqual({
      id: '314',
      state: { accountCreated: { welcomeEmailSent: true } }
    });
  });

  it('generates a password that meets the policy, shows it, and lets the administrator edit it', async () => {
    await renderPage();
    await fillAccount({ password: null });

    await click(byTestId('create-account-generate-password'));

    const password = byTestId('create-account-password');
    const confirmation = byTestId('create-account-password-confirmation');
    expect(password.value).toHaveLength(16);
    expect(confirmation.value).toBe(password.value);
    expect(password.type).toBe('text');
    expect(byTestId('create-account-generated-hint')).not.toBeNull();
    expect([...byTestId('password-rules').querySelectorAll('li')].every((item) => item.dataset.met === 'true')).toBe(true);

    await typeInto(password, PASSWORD);
    await typeInto(confirmation, PASSWORD);
    await confirmPrivacyNotice();
    await click(byTestId('create-account-submit'));
    await confirmStepUp();

    expect(createUserAccount).toHaveBeenCalledWith(expect.objectContaining({
      password: PASSWORD,
      password_confirmation: PASSWORD
    }));
  });

  it('keeps the form and explains an email already registered', async () => {
    vi.mocked(createUserAccount).mockRejectedValue(Object.assign(new Error('EMAIL_ALREADY_REGISTERED'), {
      code: 'EMAIL_ALREADY_REGISTERED',
      body: { error: 'EMAIL_ALREADY_REGISTERED', message: 'An account with that email already exists' }
    }));
    await renderPage();
    await fillAccount();
    await confirmPrivacyNotice();

    await click(byTestId('create-account-submit'));
    await confirmStepUp();

    expect(byTestId('create-account-error').textContent)
      .toBe('An account with this email already exists. Look for it in the users list.');
    expect(byTestId('created-account')).toBeNull();
    expect(document.querySelector('#create-account-email').value).toBe('ana.rojas@example.test');
    expect(byTestId('create-account-password').value).toBe(PASSWORD);
  });

  it("shows auth-backend's message for a refused field", async () => {
    vi.mocked(createUserAccount).mockRejectedValue(Object.assign(new Error('INVALID_EMAIL'), {
      code: 'INVALID_EMAIL',
      body: { error: 'INVALID_EMAIL', message: 'Invalid email address' }
    }));
    await renderPage();
    await fillAccount();
    await confirmPrivacyNotice();

    await click(byTestId('create-account-submit'));
    await confirmStepUp();

    expect(byTestId('create-account-error').textContent).toBe('Invalid email address');
  });

  it('sends nothing when the step-up is cancelled', async () => {
    await renderPage();
    await fillAccount();
    await confirmPrivacyNotice();

    await click(byTestId('create-account-submit'));
    await click(byTestId('sensitive-action-cancel'));

    expect(createUserAccount).not.toHaveBeenCalled();
    expect(byTestId('create-account-submit').disabled).toBe(false);
  });
});
