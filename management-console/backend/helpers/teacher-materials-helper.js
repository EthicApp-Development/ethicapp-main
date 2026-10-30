import {
  RENDER_IN_FLIGHT_DELETION_DELAY_SECONDS,
  caseDirectoryPath,
  isWithinUploadDirectory,
  uploadRelativePath
} from './upload-deletion-helper.js';

// What forgetting a teacher does with the teacher's materials (#877, option
// 3 of the issue), inside the forgetting transaction:
//
// - Private cases and designs that were never used in an activity and never
//   copied or imported by anyone are deleted, designs first. Their dependent
//   rows go with them (ON DELETE CASCADE): analyses, tags, videos, Google
//   documents, authors and render jobs. Their files are left for ethicapp to
//   delete (upload_deletion_requests, V32).
// - The rest of the cases and designs, and every activity, go to the
//   recipient teacher the administrator chose, or stay under the anonymized
//   account when there is none. Activities are never deleted.
// - The teacher's email is erased wherever it is stored as an author email,
//   in the teacher's materials and in other teachers' copies; the author
//   names stay, as attribution (decision of 2026-10-29).
//
// Sharing is installation-wide: a case or design is shared when its
// visibility is `public` (designs also keep the legacy `public` flag). There
// is no per-teacher sharing table.

// ethicapp's `finished` session status (ethicapp/common/modules/session-status.js).
export const FINISHED_SESSION_STATUS = 3;

// The teacher's private designs that no activity uses and nobody copied.
function deletableDesignsSql({ lock }) {
  return `
    SELECT d.id
    FROM designs d
    WHERE d.creator = $1
      AND COALESCE(d.visibility, 'private') = 'private'
      AND d.public IS NOT TRUE
      AND NOT EXISTS (
          SELECT 1
          FROM activity a
          WHERE a.design = d.id
      )
      AND NOT EXISTS (
          SELECT 1
          FROM designs copy
          WHERE copy.original_design_id = d.id
             OR copy.imported_from_design_id = d.id
      )
    ORDER BY d.id
    ${lock ? 'FOR UPDATE OF d' : ''}
  `;
}

// The teacher's private cases that nobody copied and that no design uses,
// except the designs in $2, which are deleted too. A case reaches an
// activity only through a design, so a case whose designs are all deleted
// was never used in one.
function deletableCasesSql({ lock }) {
  return `
    SELECT c.id, c.pdf_path, prj.source_path, prj.manifest_path, prj.status AS render_status
    FROM ethical_cases c
    LEFT JOIN pdf_render_jobs prj
      ON prj.owner_type = 'case'
     AND prj.owner_id = c.id
    WHERE c.creator = $1
      AND COALESCE(c.visibility, 'private') = 'private'
      AND NOT EXISTS (
          SELECT 1
          FROM ethical_cases copy
          WHERE copy.original_case_id = c.id
             OR copy.imported_from_case_id = c.id
      )
      AND NOT EXISTS (
          SELECT 1
          FROM designs d
          WHERE d.case_id = c.id
            AND d.id <> ALL($2::integer[])
      )
    ORDER BY c.id
    ${lock ? 'FOR UPDATE OF c' : ''}
  `;
}

const MATERIAL_TOTALS_SQL = `
  SELECT
      (SELECT count(*)::integer FROM ethical_cases WHERE creator = $1) AS cases,
      (SELECT count(*)::integer FROM designs WHERE creator = $1) AS designs,
      (SELECT count(*)::integer FROM sessions WHERE creator = $1) AS activities,
      (
          SELECT count(DISTINCT copy.id)::integer
          FROM ethical_cases copy
          JOIN ethical_cases source
            ON source.id = copy.original_case_id
            OR source.id = copy.imported_from_case_id
          WHERE source.creator = $1
            AND copy.creator <> $1
      ) AS case_copies_by_others,
      (
          SELECT count(DISTINCT copy.id)::integer
          FROM designs copy
          JOIN designs source
            ON source.id = copy.original_design_id
            OR source.id = copy.imported_from_design_id
          WHERE source.creator = $1
            AND copy.creator IS DISTINCT FROM $1
      ) AS design_copies_by_others
`;

// The teacher's activities that are not finished, and those whose finishing
// did not complete (activity_finalizations, V30), as ethicapp's internal
// endpoint counts them (#881).
export const OPEN_ACTIVITIES_COUNT_SQL = `
  SELECT count(*)::integer AS open_activities
  FROM sessions s
  WHERE s.creator = $1
    AND (
        s.status IS DISTINCT FROM ${FINISHED_SESSION_STATUS}
        OR EXISTS (
            SELECT 1
            FROM activity_finalizations f
            WHERE f.session_id = s.id
        )
    )
`;

async function selectDeletable(client, teacherId, { lock }) {
  const designs = await client.query(deletableDesignsSql({ lock }), [teacherId]);
  const designIds = designs.rows.map((row) => Number(row.id));
  const cases = await client.query(deletableCasesSql({ lock }), [teacherId, designIds]);

  return { designIds, cases: cases.rows };
}

/**
 * What forgetting the teacher would do with their materials, without
 * changing anything: { cases: { delete, keep }, designs: { delete, keep },
 * activities, copiesByOthers: { cases, designs } }. `keep` counts what goes
 * to the recipient, or stays under the anonymized account.
 */
export async function previewTeacherMaterials(client, teacherId) {
  const { designIds, cases } = await selectDeletable(client, teacherId, { lock: false });
  const totals = (await client.query(MATERIAL_TOTALS_SQL, [teacherId])).rows[0];

  return {
    cases: { delete: cases.length, keep: totals.cases - cases.length },
    designs: { delete: designIds.length, keep: totals.designs - designIds.length },
    activities: totals.activities,
    copiesByOthers: {
      cases: totals.case_copies_by_others,
      designs: totals.design_copies_by_others
    }
  };
}

export async function countOpenActivities(client, teacherId) {
  const result = await client.query(OPEN_ACTIVITIES_COUNT_SQL, [teacherId]);
  return Number(result.rows[0]?.open_activities || 0);
}

// The upload paths a deleted case frees: its directory, which holds its PDF,
// rendered pages and manifest, and any stored path outside it. The
// directory waits when a render may still be writing into it.
function caseFileEntries(caseRow) {
  const directory = caseDirectoryPath(caseRow.id);
  const renderInFlight = caseRow.render_status === 'pending' || caseRow.render_status === 'processing';
  const delaySeconds = renderInFlight ? RENDER_IN_FLIGHT_DELETION_DELAY_SECONDS : 0;
  const entries = [{ path: directory, recursive: true, delaySeconds }];

  for (const storedPath of [caseRow.pdf_path, caseRow.source_path, caseRow.manifest_path]) {
    const relativePath = uploadRelativePath(storedPath);
    if (relativePath && !isWithinUploadDirectory(relativePath, directory)) {
      entries.push({ path: relativePath, recursive: false, delaySeconds });
    }
  }

  return entries;
}

async function deleteMaterials(client, teacherId, { designIds, cases }) {
  const caseIds = cases.map((row) => Number(row.id));

  const designResult = designIds.length > 0
    ? await client.query(
      'DELETE FROM designs WHERE id = ANY($1::integer[]) AND creator = $2',
      [designIds, teacherId]
    )
    : { rowCount: 0 };

  let caseCount = 0;
  let orphanAuthors = 0;

  if (caseIds.length > 0) {
    const authorRows = await client.query(
      'SELECT DISTINCT author_id FROM ethical_cases_authors WHERE case_id = ANY($1::integer[])',
      [caseIds]
    );
    const caseResult = await client.query(
      'DELETE FROM ethical_cases WHERE id = ANY($1::integer[]) AND creator = $2',
      [caseIds, teacherId]
    );
    caseCount = caseResult.rowCount || 0;

    // Authors that no remaining case names any more go with the cases.
    const authorIds = authorRows.rows.map((row) => Number(row.author_id));
    if (authorIds.length > 0) {
      const orphanResult = await client.query(
        `
          DELETE FROM ethical_case_author author
          WHERE author.id = ANY($1::integer[])
            AND NOT EXISTS (
                SELECT 1
                FROM ethical_cases_authors link
                WHERE link.author_id = author.id
            )
        `,
        [authorIds]
      );
      orphanAuthors = orphanResult.rowCount || 0;
    }
  }

  return {
    designs: designResult.rowCount || 0,
    cases: caseCount,
    orphanAuthors,
    fileEntries: cases.flatMap(caseFileEntries)
  };
}

// Moves the teacher's remaining cases, designs and activities, and the
// semantic differential items of those activities, to the recipient.
async function transferMaterials(client, teacherId, recipientId) {
  const cases = await client.query(
    'UPDATE ethical_cases SET creator = $2 WHERE creator = $1',
    [teacherId, recipientId]
  );
  const designs = await client.query(
    'UPDATE designs SET creator = $2 WHERE creator = $1',
    [teacherId, recipientId]
  );
  const activities = await client.query(
    'UPDATE sessions SET creator = $2 WHERE creator = $1',
    [teacherId, recipientId]
  );
  await client.query(
    'UPDATE differential SET creator = $2 WHERE creator = $1',
    [teacherId, recipientId]
  );

  return {
    cases: cases.rowCount || 0,
    designs: designs.rowCount || 0,
    activities: activities.rowCount || 0
  };
}

async function countRemaining(client, teacherId) {
  const result = await client.query(
    `
      SELECT
          (SELECT count(*)::integer FROM ethical_cases WHERE creator = $1) AS cases,
          (SELECT count(*)::integer FROM designs WHERE creator = $1) AS designs,
          (SELECT count(*)::integer FROM sessions WHERE creator = $1) AS activities
    `,
    [teacherId]
  );
  return result.rows[0];
}

// The emails the teacher authored under, lower-cased: the account's email
// and the author entries linked to the account.
async function teacherAuthorEmails(client, teacherId, accountEmail) {
  const linked = await client.query(
    `
      SELECT DISTINCT lower(author.author_email) AS email
      FROM ethical_case_author author
      JOIN ethical_cases_authors link
        ON link.author_id = author.id
      WHERE link.user_id = $1
    `,
    [teacherId]
  );

  return [...new Set([
    String(accountEmail || '').trim().toLowerCase(),
    ...linked.rows.map((row) => row.email)
  ].filter(Boolean))];
}

/**
 * Erases the teacher's email wherever it is stored as an author email, in
 * every case and design (other teachers' copies included), keeping the
 * author names:
 * - ethical_cases.author_email becomes the account's anonymous address;
 * - each author entry (ethical_case_author) with the email becomes
 *   `anon-author-<id>@anonymous.invalid`, unique as the table requires;
 * - designs lose `metainfo.email`.
 * The cases and the author entries require an email, and the case editor and
 * the case document schema validate one, hence the addresses in the
 * reserved .invalid domain. The manifests rendered for the changed cases
 * still hold the old email, so their render jobs are queued again.
 */
async function eraseAuthorEmails(client, emails, anonymousEmail) {
  if (emails.length === 0) {
    return { cases: 0, authors: 0, designs: 0, rerenders: 0 };
  }

  const cases = await client.query(
    `
      UPDATE ethical_cases
      SET author_email = $2
      WHERE lower(author_email) = ANY($1::text[])
      RETURNING id
    `,
    [emails, anonymousEmail]
  );
  const authors = await client.query(
    `
      UPDATE ethical_case_author
      SET author_email = 'anon-author-' || id || '@anonymous.invalid',
          updated_at = NOW()
      WHERE lower(author_email) = ANY($1::text[])
    `,
    [emails]
  );
  const designs = await client.query(
    `
      UPDATE designs
      SET design = design #- '{metainfo,email}'
      WHERE lower(design #>> '{metainfo,email}') = ANY($1::text[])
    `,
    [emails]
  );

  const caseIds = cases.rows.map((row) => Number(row.id));
  const rerenders = caseIds.length > 0
    ? await client.query(
      `
        UPDATE pdf_render_jobs
        SET status = 'pending',
            attempt_count = 0,
            next_attempt_at = now(),
            started_at = NULL,
            completed_at = NULL,
            error_message = NULL,
            metadata = metadata || '{"reason": "author_email_erased"}'::jsonb
        WHERE owner_type = 'case'
          AND owner_id = ANY($1::integer[])
          AND status = 'completed'
      `,
      [caseIds]
    )
    : { rowCount: 0 };

  return {
    cases: cases.rowCount || 0,
    authors: authors.rowCount || 0,
    designs: designs.rowCount || 0,
    rerenders: rerenders.rowCount || 0
  };
}

/**
 * Handles the materials of a teacher being forgotten, inside the caller's
 * transaction, after the caller locked the teacher (and the recipient) and
 * before the per-account step replaces the account's email.
 * @param {{ query: Function }} client
 * @param {{ teacherId: number, recipientId: number|null, accountEmail: string, anonymousEmail: string }} options
 * @returns {Promise<{ deleted, transferred, kept, authorEmails, fileEntries }>}
 */
export async function handleTeacherMaterials(client, { teacherId, recipientId = null, accountEmail, anonymousEmail }) {
  // Read before anything changes: the deletions remove authors' links.
  const emails = await teacherAuthorEmails(client, teacherId, accountEmail);
  const deletable = await selectDeletable(client, teacherId, { lock: true });
  const deleted = await deleteMaterials(client, teacherId, deletable);
  const transferred = recipientId
    ? await transferMaterials(client, teacherId, recipientId)
    : { cases: 0, designs: 0, activities: 0 };
  const kept = await countRemaining(client, teacherId);
  const authorEmails = await eraseAuthorEmails(client, emails, anonymousEmail);

  return {
    deleted: { cases: deleted.cases, designs: deleted.designs, orphanAuthors: deleted.orphanAuthors },
    transferred,
    kept,
    authorEmails,
    fileEntries: deleted.fileEntries
  };
}
