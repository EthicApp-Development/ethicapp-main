// Every column that holds a users.id, in one place.
//
// The deletion of a never-activated account (account-deletion.service.js)
// refuses an account that any blocking column still references. The
// integration test user-references.integration-test.mjs compares this list
// with the foreign keys to users in the real schema (pg_constraint), and
// looks for user-like columns without a foreign key, so a migration that adds
// a reference to users fails that test until the reference is listed here.
//
// Each entry names:
// - `table` and `column`;
// - `onDelete`: the foreign key's ON DELETE rule, as the schema declares it,
//   or null for a column without a foreign key;
// - `blocksDeletion`: whether a row in it keeps an account from being
//   deleted. Columns whose rule is NO ACTION or RESTRICT, and columns without
//   a foreign key that point at the account's own data, always block. A
//   CASCADE or SET NULL column blocks when its rows are content worth more
//   than a sign-up nobody used;
// - `category`: the kind of data, which the console names when it refuses.

export const USER_REFERENCE_RULES = Object.freeze({
  noAction: 'NO ACTION',
  restrict: 'RESTRICT',
  cascade: 'CASCADE',
  setNull: 'SET NULL'
});

export const USER_REFERENCE_CATEGORIES = Object.freeze({
  activities: 'activities',
  teams: 'teams',
  responses: 'responses',
  authoredContent: 'authoredContent',
  administration: 'administration',
  aiServices: 'aiServices',
  accountData: 'accountData'
});

const { noAction, restrict, cascade, setNull } = USER_REFERENCE_RULES;
const {
  activities,
  teams,
  responses,
  authoredContent,
  administration,
  aiServices,
  accountData
} = USER_REFERENCE_CATEGORIES;

function reference(table, column, onDelete, blocksDeletion, category) {
  return Object.freeze({ table, column, onDelete, blocksDeletion, category });
}

export const USER_REFERENCES = Object.freeze([
  // Activities and their participants (V1).
  reference('sessions', 'creator', noAction, true, activities),
  reference('sesusers', 'uid', noAction, true, activities),
  // Teams (V1).
  reference('teams', 'leader', noAction, true, teams),
  reference('teamusers', 'uid', noAction, true, teams),
  reference('jigsaw_users', 'userid', noAction, true, teams),
  // Responses and chat (V1).
  reference('actor_selection', 'uid', noAction, true, responses),
  reference('chat', 'uid', noAction, true, responses),
  reference('differential', 'creator', noAction, true, responses),
  reference('differential_selection', 'uid', noAction, true, responses),
  reference('differential_chat', 'uid', noAction, true, responses),
  // Authored content. Deleting the account would delete its cases (V3) and
  // their files, so a case blocks the deletion too.
  reference('designs', 'creator', noAction, true, authoredContent),
  reference('ethical_cases', 'creator', cascade, true, authoredContent),
  // Audit rows that must outlive the account (V12, V22).
  reference('student_anonymization_events', 'user_id', restrict, true, administration),
  reference('ai_service_policy_versions', 'created_by', noAction, true, administration),
  // AI service jobs and results keep a user id without a foreign key (V15).
  reference('external_service_jobs', 'user_id', null, true, aiServices),
  reference('external_service_results', 'user_id', null, true, aiServices),
  // AI Additions erasure requests of a forgotten account (V31, #876), which
  // must outlive any change to the account row.
  reference('user_erasure_requests', 'user_id', null, true, aiServices),
  // Rows the deletion removes with the account (V10).
  reference('user_passkeys', 'user_id', cascade, false, accountData),
  // Rows that keep their meaning without the account and lose the id (V4,
  // V6, V7, V21, V22, V25).
  reference('activity_report_exports', 'actor_user_id', setNull, false, administration),
  reference('activity_report_exports', 'effective_user_id', setNull, false, administration),
  reference('ethical_cases_authors', 'user_id', setNull, false, authoredContent),
  reference('ethical_cases_tags', 'assigned_by', setNull, false, authoredContent),
  reference('designs_tags', 'assigned_by', setNull, false, authoredContent),
  reference('case_analyses', 'requested_by', setNull, false, aiServices),
  reference('case_analyses', 'reviewed_by', setNull, false, aiServices),
  reference('design_analyses', 'requested_by', setNull, false, aiServices),
  reference('design_analyses', 'reviewed_by', setNull, false, aiServices),
  reference('ai_additions_connection', 'updated_by', setNull, false, administration),
  // The administrator audit log names accounts by id on purpose, without a
  // foreign key, and keeps naming a deleted account by its former id (V27).
  reference('admin_audit_events', 'admin_user_id', null, false, administration),
  reference('admin_audit_events', 'target_user_id', null, false, administration)
]);

export const BLOCKING_USER_REFERENCES = Object.freeze(
  USER_REFERENCES.filter((entry) => entry.blocksDeletion)
);

const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/;

for (const entry of USER_REFERENCES) {
  // The names are interpolated into SQL; only plain identifiers are allowed.
  if (!IDENTIFIER_PATTERN.test(entry.table) || !IDENTIFIER_PATTERN.test(entry.column)) {
    throw new TypeError(`Invalid user reference: ${entry.table}.${entry.column}`);
  }
}

// Audit reason code of a deletion refused because of `entry`, for example
// REFERENCED_BY_SESUSERS.
export function userReferenceReasonCode(entry) {
  return `REFERENCED_BY_${entry.table.toUpperCase()}`;
}

// One query that answers, for the account in $1, the blocking references
// that hold at least one row, in the order of USER_REFERENCES.
export function buildBlockingReferencesQuery(entries = BLOCKING_USER_REFERENCES) {
  return entries
    .map((entry, index) => (
      `SELECT ${index} AS position WHERE EXISTS (SELECT 1 FROM ${entry.table} WHERE ${entry.column} = $1)`
    ))
    .join('\nUNION ALL\n')
    .concat('\nORDER BY position');
}
