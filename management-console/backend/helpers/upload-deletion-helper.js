// Files that forgetting an account leaves for ethicapp to delete (#877).
//
// The console does not mount the protected uploads volume, so the
// transaction that forgets an account records the files it frees in
// upload_deletion_requests (V32): the directories of the cases it deletes and
// the account's profile images. ethicapp deletes them in the background,
// with retries, and keeps any path that another row still references.

// Relative upload paths the table accepts: segments of letters, digits, `_`,
// `-` and `.`, at least two of them, no `.` or `..` segment. The same rule as
// the table's CHECK constraint.
const UPLOAD_PATH_PATTERN = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)+$/;
const DOT_SEGMENT_PATTERN = /(^|\/)\.{1,2}(\/|$)/;
const MAX_UPLOAD_PATH_LENGTH = 512;
const PUBLIC_PATH_PREFIXES = Object.freeze(['assets/uploads/', 'uploads/']);

// How long the deletion of a case's directory waits when the case was being
// rendered: the PDF render worker may still write pages and a manifest for
// it, since nothing stops a render in progress when its job row is deleted.
// Longer than a render can take (three commands of at most
// PDF_RENDER_TIMEOUT_MS, 2 minutes each by default).
export const RENDER_IN_FLIGHT_DELETION_DELAY_SECONDS = 10 * 60;

export function isValidUploadRelativePath(relativePath) {
  return typeof relativePath === 'string' &&
    relativePath.length <= MAX_UPLOAD_PATH_LENGTH &&
    UPLOAD_PATH_PATTERN.test(relativePath) &&
    !DOT_SEGMENT_PATTERN.test(relativePath);
}

// The path relative to the uploads root of a stored public path such as
// `/uploads/cases/12/case.pdf`, or null when it is not one ethicapp serves
// from the uploads volume or does not follow the rule above.
export function uploadRelativePath(publicPath) {
  if (typeof publicPath !== 'string') {
    return null;
  }

  const normalized = publicPath.trim().replace(/^\/+/, '');
  const prefix = PUBLIC_PATH_PREFIXES.find((candidate) => normalized.startsWith(candidate));
  if (!prefix) {
    return null;
  }

  const relativePath = normalized.slice(prefix.length);
  return isValidUploadRelativePath(relativePath) ? relativePath : null;
}

// The directory of a case's files: its PDF, rendered pages and manifest.
export function caseDirectoryPath(caseId) {
  const normalizedId = Number(caseId);
  if (!Number.isSafeInteger(normalizedId) || normalizedId <= 0) {
    throw new TypeError('A positive integer case id is required.');
  }
  return `cases/${normalizedId}`;
}

// Whether `relativePath` is `directory` or inside it.
export function isWithinUploadDirectory(relativePath, directory) {
  return relativePath === directory || relativePath.startsWith(`${directory}/`);
}

// One entry per path, keeping the longest delay and `recursive` when any
// entry of the path asks for it.
function mergeEntries(entries) {
  const byPath = new Map();

  for (const entry of entries) {
    if (!isValidUploadRelativePath(entry?.path)) {
      throw new TypeError(`Invalid upload path: ${entry?.path}`);
    }

    const delaySeconds = Math.max(0, Math.trunc(Number(entry.delaySeconds) || 0));
    const current = byPath.get(entry.path);
    byPath.set(entry.path, {
      path: entry.path,
      recursive: Boolean(entry.recursive) || Boolean(current?.recursive),
      delaySeconds: Math.max(delaySeconds, current?.delaySeconds ?? 0)
    });
  }

  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Records pending deletions of upload paths for ethicapp to process. A path
 * already recorded for the account is set back to pending.
 * @param {{ query: Function }} client - A client inside the caller's transaction.
 * @param {number} userId - The forgotten account.
 * @param {number|null} runId - The anonymization run, for the audit trail.
 * @param {{ path: string, recursive?: boolean, delaySeconds?: number }[]} entries
 * @returns {Promise<number>} How many paths were recorded.
 */
export async function recordUploadDeletionRequests(client, userId, runId, entries) {
  const merged = mergeEntries(entries);
  if (merged.length === 0) {
    return 0;
  }

  await client.query(
    `
      INSERT INTO upload_deletion_requests
          (user_id, path, recursive, next_attempt_at, anonymization_run_id)
      SELECT $1, entry.path, entry.recursive,
             now() + (entry.delay_seconds * interval '1 second'), $5
      FROM unnest($2::text[], $3::boolean[], $4::integer[])
          AS entry (path, recursive, delay_seconds)
      ON CONFLICT (user_id, path) DO UPDATE
      SET recursive = EXCLUDED.recursive,
          status = 'pending',
          attempts = 0,
          next_attempt_at = EXCLUDED.next_attempt_at,
          last_attempt_at = NULL,
          last_error = NULL,
          requested_at = now(),
          completed_at = NULL,
          anonymization_run_id = EXCLUDED.anonymization_run_id
    `,
    [
      userId,
      merged.map((entry) => entry.path),
      merged.map((entry) => entry.recursive),
      merged.map((entry) => entry.delaySeconds),
      runId
    ]
  );

  return merged.length;
}

// The deletions of an account's profile images, from the paths the users
// row held before they were cleared.
export function profileImageDeletionEntries(...publicPaths) {
  return publicPaths
    .map(uploadRelativePath)
    .filter(Boolean)
    .map((path) => ({ path, recursive: false }));
}
