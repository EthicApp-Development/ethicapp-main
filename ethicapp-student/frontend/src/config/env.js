function ensureLeadingSlash(value) {
  return value.startsWith('/') ? value : `/${value}`;
}

function ensureTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

function parseBoolean(value) {
  return String(value || '').toLowerCase() === 'true';
}

const runtimeConfig = typeof window !== 'undefined'
  ? window.__STUDENT_RUNTIME_CONFIG__ || {}
  : {};

const runtimeStudentApiBasePath = (runtimeConfig.studentApiBasePath || '').trim();
const runtimeStudentSocketUrl = (runtimeConfig.studentSocketUrl || '').trim();
const viteStudentApiBasePath = (import.meta.env.VITE_STUDENT_API_BASE_PATH || '').trim();
const viteStudentSocketUrl = (import.meta.env.VITE_STUDENT_SOCKET_URL || '').trim();

const studentApiBasePath = runtimeStudentApiBasePath
  ? ensureTrailingSlash(ensureLeadingSlash(runtimeStudentApiBasePath))
  : (
      viteStudentApiBasePath
        ? ensureTrailingSlash(ensureLeadingSlash(viteStudentApiBasePath))
        : '/student/api/'
    );

const studentSocketUrl = runtimeStudentSocketUrl
  || viteStudentSocketUrl
  || (typeof window !== 'undefined' ? window.location.origin : '');

const showDevMetadata = parseBoolean(
  runtimeConfig.showDevMetadata ?? import.meta.env.VITE_SHOW_DEV_METADATA
);

export { showDevMetadata, studentApiBasePath, studentSocketUrl };
