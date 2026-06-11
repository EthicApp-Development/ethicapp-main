const DEFAULT_MNG_SESSION_COOKIE_MAX_AGE_MS = 2 * 60 * 60 * 1000;

function parsePositiveInteger(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0
    ? numberValue
    : fallback;
}

function getManagementSessionCookieMaxAgeMs() {
  return parsePositiveInteger(
    process.env.MNG_SESSION_COOKIE_MAX_AGE_MS,
    DEFAULT_MNG_SESSION_COOKIE_MAX_AGE_MS
  );
}

export {
  DEFAULT_MNG_SESSION_COOKIE_MAX_AGE_MS,
  getManagementSessionCookieMaxAgeMs
};
