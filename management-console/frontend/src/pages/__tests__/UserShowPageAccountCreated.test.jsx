// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../app/providers.jsx';
import { fetchUserById } from '../../api/usersApi.js';
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
  fetchPasswordPolicy: vi.fn(async () => ({ minLength: 10, minSymbols: 2 })),
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

const createdTeacher = Object.freeze({
  id: 314,
  firstname: 'Ana',
  lastname: 'Rojas',
  sex: 'F',
  email: 'ana.rojas@example.test',
  role: 'P',
  active: true,
  emailConfirmed: true,
  status: 'active',
  lastLoginAt: null,
  createdAt: '2026-11-08T12:00:00.000Z'
});

let container;
let root;
let currentLocation;

function LocationProbe() {
  currentLocation = useLocation();
  return null;
}

async function renderPage(state) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root.render(
      <AppProviders>
        <MemoryRouter initialEntries={[{ pathname: '/users/314', state }]}>
          <Routes>
            <Route
              path="/users/:id"
              element={(
                <>
                  <UserShowPage />
                  <LocationProbe />
                </>
              )}
            />
          </Routes>
        </MemoryRouter>
      </AppProviders>
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function notice() {
  return document.querySelector('[data-testid="account-created-notice"]');
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(fetchUserById).mockReset().mockResolvedValue({ ...createdTeacher });
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  document.body.innerHTML = '';
});

describe('UserShowPage after creating the account (#1170)', () => {
  it('says the account was created and the welcome email sent, once', async () => {
    await renderPage({ accountCreated: { welcomeEmailSent: true } });

    expect(notice().textContent).toContain('The account was created and the welcome email was sent.');
    expect(notice().className).toContain('alert-success');
    // The history entry no longer carries the notice.
    expect(currentLocation.state).toBeNull();
  });

  it('warns when the welcome email could not be sent', async () => {
    await renderPage({ accountCreated: { welcomeEmailSent: false } });

    expect(notice().textContent).toContain('sending the welcome email could not be confirmed');
    expect(notice().className).toContain('alert-warning');
  });

  it('shows no notice on a plain visit', async () => {
    await renderPage(undefined);

    expect(notice()).toBeNull();
  });
});
