function ensureLeadingSlash(value) {
  return value.startsWith('/') ? value : `/${value}`;
}

function ensureTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

const viteStudentApiBasePath = (import.meta.env.VITE_STUDENT_API_BASE_PATH || '').trim();
const viteStudentSocketUrl = (import.meta.env.VITE_STUDENT_SOCKET_URL || '').trim();

const studentApiBasePath = viteStudentApiBasePath
  ? ensureTrailingSlash(ensureLeadingSlash(viteStudentApiBasePath))
  : '/student/api/';

const studentSocketUrl = viteStudentSocketUrl || (typeof window !== 'undefined' ? window.location.origin : '');

export { studentApiBasePath, studentSocketUrl };
