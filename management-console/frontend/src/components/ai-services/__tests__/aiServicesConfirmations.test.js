import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPolicyVersion, removeConnection, saveConnection } from '../../../api/aiServicesApi.js';
import { parseJson } from '../../../api/usersApi.js';
import enUS from '../../../i18n/locales/en_US.js';
import esCL from '../../../i18n/locales/es_CL.js';
import {
  removeConnectionConfirmation,
  saveConnectionConfirmation,
  savePolicyConfirmation
} from '../aiServicesConfirmations.js';
import { serviceNamesById } from '../aiServicesFormat.js';

const PASSWORD_STEP_UP = { admin_password: 'admin-secret', recaptcha_token: 'token-1' };
const PASSKEY_STEP_UP = { passkey_assertion: { id: 'credential-1' } };

// t() stand-in that shows which key and values were used.
const t = (key, values) => (values ? `${key} ${JSON.stringify(values)}` : key);

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function lookup(dictionary, key) {
  return key.split('.').reduce((node, part) => node?.[part], dictionary);
}

describe('AI services confirmations', () => {
  it('confirms saving the connection, naming the URL, then saves it with the step-up fields', async () => {
    const save = vi.fn(async () => ({ baseUrl: 'https://ai.example.org' }));
    const values = { baseUrl: ' https://ai.example.org ', keycloakPublicUrl: '' };
    const request = saveConnectionConfirmation({ t, values, saveConnection: save });

    expect(request.title).toBe('pages.aiServices.connection.confirmSave.title');
    expect(request.description).toContain('"baseUrl":"https://ai.example.org"');
    expect(request.confirmLabel).toBe('pages.aiServices.connection.actions.save');

    await expect(request.action(PASSWORD_STEP_UP)).resolves.toEqual({ baseUrl: 'https://ai.example.org' });
    expect(save).toHaveBeenCalledWith(values, PASSWORD_STEP_UP);
  });

  it('confirms removing the connection with its consequences, then removes it with the step-up fields', async () => {
    const remove = vi.fn(async () => ({ removed: true }));
    const request = removeConnectionConfirmation({ t, removeConnection: remove });

    expect(request.description).toBe('pages.aiServices.connection.remove.body');
    expect(request.details).toBe('pages.aiServices.connection.remove.policyKept');
    expect(request.confirmVariant).toBe('danger');

    await request.action(PASSKEY_STEP_UP);
    expect(remove).toHaveBeenCalledWith(PASSKEY_STEP_UP);
  });

  it('confirms a policy version with the allowed services by name, or with none', async () => {
    const create = vi.fn(async () => ({ id: 4 }));
    const namesById = serviceNamesById([{ id: 'polyadic-agent', name: 'Polyadic agent' }]);
    const input = { allowedServiceIds: ['polyadic-agent', 'retired-service'], note: 'Pilot' };
    const request = savePolicyConfirmation({ t, input, namesById, createPolicyVersion: create });

    expect(request.description).toContain('"services":"Polyadic agent, retired-service"');
    expect(request.details).toBe('pages.aiServices.services.launchNotice');

    await request.action(PASSWORD_STEP_UP);
    expect(create).toHaveBeenCalledWith(input, PASSWORD_STEP_UP);

    const none = savePolicyConfirmation({ t, input: { allowedServiceIds: [], note: '' }, namesById, createPolicyVersion: create });
    expect(none.description).toBe('pages.aiServices.services.confirmSave.none');
  });

  it('names the switched-off adapters in the policy confirmation', () => {
    const namesById = serviceNamesById([{ id: 'case-analyst', name: 'Case Analyst' }]);
    const adapterNamesById = new Map([['case-analyst-claim-typology', 'Claim typology']]);
    const request = savePolicyConfirmation({
      t,
      input: { allowedServiceIds: ['case-analyst'], disabledAdapterIds: ['case-analyst-claim-typology'], note: '' },
      namesById,
      adapterNamesById,
      createPolicyVersion: vi.fn()
    });

    expect(request.description).toContain('"services":"Case Analyst"');
    expect(request.description).toContain('pages.aiServices.services.confirmSave.disabledAdapters {"adapters":"Claim typology"}');
  });

  it('uses keys defined in both locales', () => {
    const keys = [
      'pages.aiServices.connection.confirmSave.title',
      'pages.aiServices.connection.confirmSave.body',
      'pages.aiServices.connection.confirmSave.details',
      'pages.aiServices.connection.remove.confirm',
      'pages.aiServices.services.confirmSave.title',
      'pages.aiServices.services.confirmSave.allowed',
      'pages.aiServices.services.confirmSave.none',
      'pages.aiServices.services.confirmSave.disabledAdapters',
      'pages.aiServices.services.confirmSave.confirm'
    ];
    for (const key of keys) {
      expect(typeof lookup(enUS, key)).toBe('string');
      expect(typeof lookup(esCL, key)).toBe('string');
    }
  });
});

describe('AI services API writes', () => {
  let requests;
  let nextResponse;

  beforeEach(() => {
    requests = [];
    nextResponse = () => jsonResponse(200, {});
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if (url === '/mng/api/csrf-token') {
        return jsonResponse(200, { csrfToken: 'csrf-1' });
      }
      requests.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : undefined });
      return nextResponse();
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the step-up fields with each write', async () => {
    nextResponse = () => jsonResponse(200, { connection: { baseUrl: 'https://ai.example.org' }, version: { id: 2 } });

    await saveConnection({ baseUrl: 'https://ai.example.org', keycloakPublicUrl: '' }, PASSWORD_STEP_UP);
    await removeConnection(PASSKEY_STEP_UP);
    await createPolicyVersion({ allowedServiceIds: ['polyadic-agent'], note: 'Pilot' }, PASSWORD_STEP_UP);
    await createPolicyVersion({
      allowedServiceIds: ['case-analyst'],
      disabledAdapterIds: ['case-analyst-claim-typology'],
      note: ''
    }, PASSKEY_STEP_UP);

    expect(requests).toEqual([
      {
        url: '/mng/api/ai-services/connection',
        method: 'PUT',
        body: { baseUrl: 'https://ai.example.org', keycloakPublicUrl: '', ...PASSWORD_STEP_UP }
      },
      { url: '/mng/api/ai-services/connection', method: 'DELETE', body: PASSKEY_STEP_UP },
      {
        url: '/mng/api/ai-services/policy',
        method: 'POST',
        body: { allowedServiceIds: ['polyadic-agent'], disabledAdapterIds: [], note: 'Pilot', ...PASSWORD_STEP_UP }
      },
      {
        url: '/mng/api/ai-services/policy',
        method: 'POST',
        body: {
          allowedServiceIds: ['case-analyst'],
          disabledAdapterIds: ['case-analyst-claim-typology'],
          note: '',
          ...PASSKEY_STEP_UP
        }
      }
    ]);
  });

  it('reports a refused confirmation by its code instead of treating it as an expired session', async () => {
    nextResponse = () => jsonResponse(401, { error: 'Invalid administrator password' });
    await expect(removeConnection(PASSWORD_STEP_UP)).rejects.toMatchObject({ code: 'Invalid administrator password' });

    nextResponse = () => jsonResponse(401, { error: 'PASSKEY_REQUIRED' });
    await expect(parseJson(nextResponse())).rejects.toMatchObject({ code: 'PASSKEY_REQUIRED' });

    nextResponse = () => jsonResponse(400, { error: 'Invalid recaptcha token' });
    await expect(removeConnection(PASSWORD_STEP_UP)).rejects.toMatchObject({ code: 'Invalid recaptcha token' });
  });

  it('still treats the edge 401 for a missing session as an expired session', async () => {
    nextResponse = () => jsonResponse(401, { status: 'expired' });
    await expect(removeConnection(PASSWORD_STEP_UP)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    await expect(parseJson(jsonResponse(401, { status: 'expired' }))).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });
});
