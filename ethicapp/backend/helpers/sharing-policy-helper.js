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

export function buildAttributionText({ title, author, licenseCode }) {
    return [
        title ? `"${title}"` : null,
        author ? `by ${author}` : null,
        licenseCode ? `licensed ${licenseCode}` : null,
    ].filter(Boolean).join(", ");
}
