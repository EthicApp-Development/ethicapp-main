function ensureLeadingSlash(value) {
  return value.startsWith('/') ? value : `/${value}`;
}

function ensureTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

const viteStudentApiBasePath = (import.meta.env.VITE_STUDENT_API_BASE_PATH || '').trim();

const studentApiBasePath = viteStudentApiBasePath
  ? ensureTrailingSlash(ensureLeadingSlash(viteStudentApiBasePath))
  : '/student/api/';

export { studentApiBasePath };
