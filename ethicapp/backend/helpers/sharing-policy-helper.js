"use strict";

export const CASE_DEFAULT_LICENSE = "CC-BY-NC-SA-4.0";
export const DESIGN_DEFAULT_LICENSE = "CC-BY-SA-4.0";
export const DEFAULT_LANGUAGE_CODE = "es_CL";
export const PRIVATE_VISIBILITY = "private";
export const PUBLIC_VISIBILITY = "public";
export const OWN_WORK_RIGHTS_STATUS = "own_work";
export const OPEN_LICENSE_RIGHTS_STATUS = "open_license";
export const USED_WITH_PERMISSION_RIGHTS_STATUS = "used_with_permission";
export const COMMERCIAL_LICENSE_RIGHTS_STATUS = "commercial_license";
export const PUBLIC_DOMAIN_RIGHTS_STATUS = "public_domain";
export const UNKNOWN_RIGHTS_STATUS = "unknown";

const rightsStatuses = new Set([
    OWN_WORK_RIGHTS_STATUS,
    OPEN_LICENSE_RIGHTS_STATUS,
    USED_WITH_PERMISSION_RIGHTS_STATUS,
    COMMERCIAL_LICENSE_RIGHTS_STATUS,
    PUBLIC_DOMAIN_RIGHTS_STATUS,
    UNKNOWN_RIGHTS_STATUS,
]);

export function normalizeVisibility(value, fallback = PRIVATE_VISIBILITY) {
    return value === PUBLIC_VISIBILITY || value === PRIVATE_VISIBILITY ? value : fallback;
}

export function isPublicVisibility(value) {
    return normalizeVisibility(value) === PUBLIC_VISIBILITY;
}

export function normalizeLicenseCode(value, fallback) {
    const licenseCode = String(value || "").trim();
    return licenseCode || fallback;
}

export function normalizeLanguageCode(value, fallback = DEFAULT_LANGUAGE_CODE) {
    const languageCode = String(value || "").trim();
    return languageCode || fallback;
}

export function normalizeRightsStatus(value, fallback = OWN_WORK_RIGHTS_STATUS) {
    return rightsStatuses.has(value) ? value : fallback;
}

export function getCaseAuthorName(caseObj) {
    return [
        caseObj?.author_firstname || caseObj?.authorFirstname,
        caseObj?.author_lastname || caseObj?.authorLastname,
    ].filter(Boolean).join(" ");
}

export function getDesignTitle(design) {
    return design?.metainfo?.title || design?.title || "Untitled design";
}

export function getLocalizedCopyLabel(languageCode) {
    return String(languageCode || "").toLowerCase().startsWith("es") ? "copia" : "copy";
}

export function buildLocalizedCopyTitle(title, languageCode, copyIndex = 0) {
    const baseTitle = String(title || "").trim() || "Untitled";
    const copyLabel = getLocalizedCopyLabel(languageCode);
    const suffix = copyIndex > 0 ? ` (${copyLabel} ${copyIndex})` : ` (${copyLabel})`;
    return `${baseTitle}${suffix}`;
}

export function getUserDisplayName(user) {
    return [
        user?.firstname,
        user?.lastname,
    ].filter(Boolean).join(" ") || user?.name || user?.mail || "";
}

/**
 * The name a design is attributed to: its creator's. When the creator's
 * account was anonymized (#877), it names no one, so the design is
 * attributed to the author name it keeps in `metainfo.author`, which
 * forgetting a teacher keeps as attribution.
 * @param {object} row - With creator_firstname, creator_lastname,
 *     creator_name, creator_email and creator_anonymized.
 * @param {object} [designDocument] - The design's jsonb document.
 * @returns {string}
 */
export function getDesignAuthorName(row, designDocument) {
    const anonymized = row?.creator_anonymized === true;
    const keptAuthor = anonymized ? String(designDocument?.metainfo?.author || "").trim() : "";

    return keptAuthor || getUserDisplayName({
        firstname: row?.creator_firstname,
        lastname:  row?.creator_lastname,
        name:      row?.creator_name,
        mail:      anonymized ? null : row?.creator_email,
    });
}

export function buildAttributionText({ title, author, licenseCode }) {
    return [
        title ? `"${title}"` : null,
        author ? `by ${author}` : null,
        licenseCode ? `licensed ${licenseCode}` : null,
    ].filter(Boolean).join(", ");
}

const caseSharingBodyKeys = [
    "visibility",
    "license_code", "licenseCode",
    "attribution_text", "attributionText",
    "rights_status", "rightsStatus",
    "license_notes", "licenseNotes",
    "permission_statement", "permissionStatement",
    "commercial_source", "commercialSource",
];

/**
 * Whether a JSON body can carry case sharing fields: an object whose sharing
 * fields, when present, are strings or null. A multipart form only sends
 * strings; a JSON body could send numbers, lists or objects.
 * @param {*} body
 * @returns {boolean}
 */
export function hasValidCaseSharingFieldTypes(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return false;
    }
    return caseSharingBodyKeys.every((key) => {
        const value = body[key];
        return value === undefined || value === null || typeof value === "string";
    });
}

/**
 * The sharing fields of a case save, by the case form (`PATCH /cases/:id`) or
 * the sharing settings (`PATCH /cases/:id/sharing`): its visibility, license
 * and rights. Each field is read in snake or camel case. A field the request
 * leaves out keeps the case's current value, and so does a visibility,
 * license or rights status that is not valid.
 * @param {object} body - The request body.
 * @param {object} existingCase - The case's row, with visibility,
 *     license_code, attribution_text, rights_status, license_notes,
 *     permission_statement and commercial_source.
 * @returns {{visibility: string, licenseCode: string,
 *     attributionText: ?string, rightsStatus: string, licenseNotes: ?string,
 *     permissionStatement: ?string, commercialSource: ?string}}
 */
export function normalizeCaseSharingFields(body, existingCase) {
    return {
        visibility: normalizeVisibility(
            body.visibility,
            existingCase.visibility || PRIVATE_VISIBILITY
        ),
        licenseCode: normalizeLicenseCode(
            body.license_code ?? body.licenseCode,
            existingCase.license_code || CASE_DEFAULT_LICENSE
        ),
        attributionText: body.attribution_text ?? body.attributionText
            ?? existingCase.attribution_text ?? null,
        rightsStatus: normalizeRightsStatus(
            body.rights_status ?? body.rightsStatus,
            existingCase.rights_status
        ),
        licenseNotes: body.license_notes ?? body.licenseNotes
            ?? existingCase.license_notes ?? null,
        permissionStatement: body.permission_statement ?? body.permissionStatement
            ?? existingCase.permission_statement ?? null,
        commercialSource: body.commercial_source ?? body.commercialSource
            ?? existingCase.commercial_source ?? null,
    };
}
