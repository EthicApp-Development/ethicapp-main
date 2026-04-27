function toQueryString(params) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      searchParams.set(key, String(value));
    }
  });

  return searchParams.toString();
}

async function parseJson(response) {
  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(json.error || 'Request failed');
  }

  return json;
}

export async function fetchUsers({ keywords = '', role = '', page = 1 }) {
  const query = toQueryString({ q: keywords, role, page });
  const response = await fetch(`/mng/api/users?${query}`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json'
    }
  });

  return parseJson(response);
}

export async function fetchUserById(userId) {
  const response = await fetch(`/mng/api/users/${userId}`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json'
    }
  });

  return parseJson(response);
}

export async function updateUser(userId, payload) {
  const response = await fetch(`/mng/api/users/${userId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(payload)
  });

  return parseJson(response);
}

export async function triggerPasswordReset(userId, payload) {
  const response = await fetch(`/mng/api/users/${userId}/password-reset`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(payload)
  });

  return parseJson(response);
}

export async function impersonateProfessor(userId, payload) {
  const response = await fetch(`/mng/api/users/${userId}/impersonate-professor`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(payload)
  });

  return parseJson(response);
}
