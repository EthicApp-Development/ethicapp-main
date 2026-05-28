import { query } from '../config/database.js';

const CONTACT_TYPES = ['technical', 'academic'];
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg']);
const MAX_LOGO_BYTES = 1024 * 1024;

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeContactType(value) {
  const normalized = normalizeText(value).toLowerCase();
  return CONTACT_TYPES.includes(normalized) ? normalized : null;
}

function normalizePhoneCountryCode(value) {
  const normalized = normalizeText(value);
  return normalized ? normalized.replace(/[^\d+]/g, '') : '';
}

function normalizePhoneNumber(value) {
  return normalizeText(value).replace(/\D/g, '');
}

function mapContact(row) {
  return {
    type: row.contact_type,
    firstname: row.firstname || '',
    lastname: row.lastname || '',
    email: row.email || '',
    phoneCountryCode: row.phone_country_code || '',
    phoneNumber: row.phone_number || ''
  };
}

function mapInstitution(row, contacts) {
  const logoUpdatedAt = row.logo_updated_at ? new Date(row.logo_updated_at).getTime() : null;

  return {
    id: row.id,
    name: row.name || '',
    logo: row.logo_mime_type
      ? {
          filename: row.logo_filename || '',
          mimeType: row.logo_mime_type,
          url: `/mng/api/institution/logo${logoUpdatedAt ? `?v=${logoUpdatedAt}` : ''}`
        }
      : null,
    contacts
  };
}

function decodeLogoPayload(logo) {
  if (!logo) {
    return null;
  }

  const mimeType = normalizeText(logo.mimeType || logo.mime_type).toLowerCase();
  const data = normalizeText(logo.data);
  const filename = normalizeText(logo.filename);

  if (!IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error('INVALID_LOGO_TYPE');
  }

  if (!data) {
    throw new Error('INVALID_LOGO_DATA');
  }

  const bytes = Buffer.from(data, 'base64');
  if (bytes.length === 0) {
    throw new Error('INVALID_LOGO_DATA');
  }

  if (bytes.length > MAX_LOGO_BYTES) {
    throw new Error('LOGO_SIZE_LIMIT_EXCEEDED');
  }

  const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

  if ((mimeType === 'image/png' && !isPng) || (mimeType !== 'image/png' && !isJpeg)) {
    throw new Error('INVALID_LOGO_DATA');
  }

  return {
    filename,
    mimeType: mimeType === 'image/jpg' ? 'image/jpeg' : mimeType,
    bytes
  };
}

function normalizeContactPayload(contactType, payload = {}) {
  return {
    type: contactType,
    firstname: normalizeText(payload.firstname),
    lastname: normalizeText(payload.lastname),
    email: normalizeEmail(payload.email),
    phoneCountryCode: normalizePhoneCountryCode(payload.phoneCountryCode || payload.phone_country_code),
    phoneNumber: normalizePhoneNumber(payload.phoneNumber || payload.phone_number)
  };
}

export async function getInstitutionSettings() {
  await query(
    `
      INSERT INTO institution (id, name)
      VALUES (1, '')
      ON CONFLICT (id) DO NOTHING
    `
  );

  const institutionResult = await query(
    `
      SELECT id, name, logo_filename, logo_mime_type, logo_updated_at
      FROM institution
      WHERE id = 1
      LIMIT 1
    `
  );

  const contactsResult = await query(
    `
      SELECT contact_type, firstname, lastname, email, phone_country_code, phone_number
      FROM institutional_contacts
      WHERE institution_id = 1
      ORDER BY CASE contact_type WHEN 'technical' THEN 1 WHEN 'academic' THEN 2 ELSE 3 END
    `
  );

  const contactsByType = Object.fromEntries(contactsResult.rows.map((row) => [row.contact_type, mapContact(row)]));
  const contacts = CONTACT_TYPES.map((contactType) => (
    contactsByType[contactType] || normalizeContactPayload(contactType)
  ));

  return mapInstitution(institutionResult.rows[0], contacts);
}

export async function getInstitutionLogo() {
  const result = await query(
    `
      SELECT logo_filename, logo_mime_type, logo_bytes, logo_updated_at
      FROM institution
      WHERE id = 1
        AND logo_bytes IS NOT NULL
      LIMIT 1
    `
  );

  if (result.rowCount === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    filename: row.logo_filename || 'institution-logo',
    mimeType: row.logo_mime_type,
    bytes: row.logo_bytes,
    updatedAt: row.logo_updated_at
  };
}

export async function updateInstitutionSettings(payload) {
  const name = normalizeText(payload.name);
  const contacts = payload.contacts || {};
  const logo = decodeLogoPayload(payload.logo);
  const removeLogo = payload.removeLogo === true || payload.remove_logo === true;

  if (!name) {
    throw new Error('MISSING_INSTITUTION_NAME');
  }

  const normalizedContacts = CONTACT_TYPES.map((contactType) => (
    normalizeContactPayload(contactType, contacts[contactType])
  ));

  if (removeLogo) {
    await query(
      `
        UPDATE institution
        SET name = $1,
            logo_filename = NULL,
            logo_mime_type = NULL,
            logo_bytes = NULL,
            logo_updated_at = NULL,
            updated_at = NOW()
        WHERE id = 1
      `,
      [name]
    );
  } else if (logo) {
    await query(
      `
        UPDATE institution
        SET name = $1,
            logo_filename = $2,
            logo_mime_type = $3,
            logo_bytes = $4,
            logo_updated_at = NOW(),
            updated_at = NOW()
        WHERE id = 1
      `,
      [name, logo.filename, logo.mimeType, logo.bytes]
    );
  } else {
    await query(
      `
        UPDATE institution
        SET name = $1,
            updated_at = NOW()
        WHERE id = 1
      `,
      [name]
    );
  }

  for (const contact of normalizedContacts) {
    const contactType = normalizeContactType(contact.type);
    if (!contactType) {
      throw new Error('INVALID_CONTACT_TYPE');
    }

    await query(
      `
        INSERT INTO institutional_contacts
          (institution_id, contact_type, firstname, lastname, email, phone_country_code, phone_number)
        VALUES
          (1, $1, $2, $3, $4, $5, $6)
        ON CONFLICT (institution_id, contact_type) DO UPDATE
        SET firstname = EXCLUDED.firstname,
            lastname = EXCLUDED.lastname,
            email = EXCLUDED.email,
            phone_country_code = EXCLUDED.phone_country_code,
            phone_number = EXCLUDED.phone_number,
            updated_at = NOW()
      `,
      [
        contactType,
        contact.firstname,
        contact.lastname,
        contact.email,
        contact.phoneCountryCode,
        contact.phoneNumber
      ]
    );
  }

  return getInstitutionSettings();
}
