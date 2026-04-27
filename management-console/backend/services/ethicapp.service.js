const ETHICAPP_INTERNAL_BASE_URL = process.env.ETHICAPP_INTERNAL_BASE_URL || 'http://ethicapp:8501';

function buildUrl(pathname) {
  return `${ETHICAPP_INTERNAL_BASE_URL.replace(/\/$/, '')}${pathname}`;
}

export async function impersonateProfessorInEthicapp({ professorId, cookie }) {
  const response = await fetch(buildUrl(`/api/admin/impersonation/professor/${professorId}`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie || ''
    }
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.error || 'IMPERSONATION_FAILED');
  }

  return response.json();
}
