import { query } from '../config/database.js';

const ALLOWED_ROLE_FILTERS = new Set(['A', 'P', 'S']);

function normalizeRoleFilter(role) {
  const normalized = String(role || '').trim().toUpperCase();
  return ALLOWED_ROLE_FILTERS.has(normalized) ? normalized : null;
}

export async function listUsers({ keywords = '', role = null, page = 1, pageSize = 10 }) {
  const normalizedKeywords = String(keywords || '').trim().toLowerCase();
  const normalizedRole = normalizeRoleFilter(role);
  const safePageSize = Math.min(Math.max(Number(pageSize) || 10, 1), 50);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safePageSize;

  const filterClauses = [];
  const params = [];

  if (normalizedKeywords) {
    params.push(`%${normalizedKeywords}%`);
    const idx = params.length;

    filterClauses.push(`(
      lower(coalesce(firstname, '')) LIKE $${idx}
      OR lower(coalesce(lastname, '')) LIKE $${idx}
      OR lower(coalesce(mail, '')) LIKE $${idx}
      OR lower(coalesce(name, '')) LIKE $${idx}
      OR lower(coalesce(rut, '')) LIKE $${idx}
    )`);
  }

  if (normalizedRole) {
    params.push(normalizedRole);
    filterClauses.push(`role = $${params.length}`);
  }

  const whereSql = filterClauses.length ? `WHERE ${filterClauses.join(' AND ')}` : '';

  const countResult = await query(
    `
      SELECT count(*)::int AS total
      FROM users
      ${whereSql}
    `,
    params
  );

  const total = countResult.rows[0]?.total || 0;

  params.push(safePageSize);
  const limitIndex = params.length;
  params.push(offset);
  const offsetIndex = params.length;

  const rowsResult = await query(
    `
      SELECT
        id,
        firstname,
        lastname,
        mail,
        role,
        active,
        email_confirmed
      FROM users
      ${whereSql}
      ORDER BY id DESC
      LIMIT $${limitIndex}
      OFFSET $${offsetIndex}
    `,
    params
  );

  const items = rowsResult.rows.map((row) => ({
    id: row.id,
    firstname: row.firstname || '',
    lastname: row.lastname || '',
    email: row.mail || '',
    role: row.role || '',
    active: row.active !== false,
    emailConfirmed: row.email_confirmed !== false
  }));

  return {
    items,
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(Math.ceil(total / safePageSize), 1)
  };
}

export async function getUserById(userId) {
  const normalizedId = Number(userId);

  if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
    return null;
  }

  const result = await query(
    `
      SELECT
        id,
        firstname,
        lastname,
        sex,
        mail,
        role,
        active,
        email_confirmed
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [normalizedId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  const row = result.rows[0];

  return {
    id: row.id,
    firstname: row.firstname || '',
    lastname: row.lastname || '',
    sex: row.sex || '',
    email: row.mail || '',
    role: row.role || '',
    active: row.active !== false,
    emailConfirmed: row.email_confirmed !== false
  };
}

export async function updateUserById(userId, payload) {
  const normalizedId = Number(userId);

  if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
    throw new Error('INVALID_USER_ID');
  }

  const firstname = String(payload.firstname || '').trim();
  const lastname = String(payload.lastname || '').trim();
  const sex = String(payload.sex || '').trim().toUpperCase();
  const email = String(payload.email || '').trim().toLowerCase();
  const emailConfirmation = String(payload.email_confirmation || '').trim().toLowerCase();
  const role = String(payload.role || '').trim().toUpperCase();

  if (!firstname || !lastname || !sex || !email || !role) {
    throw new Error('MISSING_REQUIRED_FIELDS');
  }

  if (!['F', 'M', 'O'].includes(sex)) {
    throw new Error('INVALID_GENDER');
  }

  if (!['A', 'P', 'S'].includes(role)) {
    throw new Error('INVALID_ROLE');
  }

  if (email !== emailConfirmation) {
    throw new Error('EMAIL_CONFIRMATION_MISMATCH');
  }

  const currentResult = await query(
    `
      SELECT id, role, mail, active
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [normalizedId]
  );

  if (currentResult.rowCount === 0) {
    throw new Error('USER_NOT_FOUND');
  }

  const currentUser = currentResult.rows[0];
  const active = Object.prototype.hasOwnProperty.call(payload, 'active')
    ? payload.active === true || payload.active === 'true' || payload.active === 'on'
    : currentUser.active !== false;
  const isRoleChanged = (currentUser.role || '') !== role;
  const validTransition =
    (currentUser.role === 'A' && role === 'P') ||
    (currentUser.role === 'P' && role === 'A') ||
    !isRoleChanged;

  if (!validTransition) {
    throw new Error('INVALID_ROLE_TRANSITION');
  }

  const duplicatedEmailResult = await query(
    `
      SELECT id
      FROM users
      WHERE lower(mail) = $1
        AND id <> $2
      LIMIT 1
    `,
    [email, normalizedId]
  );

  if (duplicatedEmailResult.rowCount > 0) {
    throw new Error('EMAIL_ALREADY_EXISTS');
  }

  const fullName = `${firstname} ${lastname}`.trim();

  const updateResult = await query(
    `
      UPDATE users
      SET firstname = $1,
          lastname = $2,
          name = $3,
          sex = $4,
          mail = $5,
          role = $6,
          active = $7,
          email_confirmed = CASE WHEN $7 = true THEN true ELSE email_confirmed END
      WHERE id = $8
      RETURNING id, firstname, lastname, sex, mail, role, active, email_confirmed
    `,
    [firstname, lastname, fullName, sex, email, role, active, normalizedId]
  );

  const row = updateResult.rows[0];

  return {
    id: row.id,
    firstname: row.firstname || '',
    lastname: row.lastname || '',
    sex: row.sex || '',
    email: row.mail || '',
    role: row.role || '',
    active: row.active !== false,
    emailConfirmed: row.email_confirmed !== false
  };
}
