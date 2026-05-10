const ETHICAPP_INTERNAL_BASE_URL = process.env.ETHICAPP_INTERNAL_BASE_URL || 'http://ethicapp:8501';

function buildUrl(pathname) {
  return `${ETHICAPP_INTERNAL_BASE_URL.replace(/\/$/, '')}${pathname}`;
}

function getSetCookieHeaders(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie();
  }

  const setCookie = response.headers.get('set-cookie');
  return setCookie ? [setCookie] : [];
}

async function parseResponseBody(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

export async function impersonateProfessorInEthicapp({
  professorId,
  cookie,
  userId,
  userRole
}) {
  const response = await fetch(buildUrl(`/api/admin/impersonation/professor/${professorId}`), {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: cookie || '',
      'X-User-Id': String(userId || ''),
      'X-User-Role': String(userRole || '')
    }
  });

  if (!response.ok) {
    const errorBody = await parseResponseBody(response);
    throw new Error(errorBody.error || 'IMPERSONATION_FAILED');
  }

  return {
    body: await parseResponseBody(response),
    setCookies: getSetCookieHeaders(response)
  };
}
