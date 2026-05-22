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

const openLicenseCodes = new Set([
    "CC-BY-4.0",
    "CC-BY-SA-4.0",
    "CC-BY-NC-SA-4.0",
]);

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

export function parseOptionalBoolean(value) {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }

    return value === true || value === "true" || value === "1" || value === 1;
}

export function normalizeRightsStatus(value, fallback = OWN_WORK_RIGHTS_STATUS) {
    return rightsStatuses.has(value) ? value : fallback;
}

export function isOpenLicenseCode(licenseCode) {
    return openLicenseCodes.has(licenseCode);
}

export function canCaseBeSharedPublicly(caseObj) {
    return parseOptionalBoolean(caseObj?.can_be_shared_publicly ?? caseObj?.canBeSharedPublicly) === true;
}

export function canCaseBeCopiedByOthers(caseObj) {
    return parseOptionalBoolean(caseObj?.can_be_copied_by_others ?? caseObj?.canBeCopiedByOthers) === true;
}

export function deriveCaseSharingFlags({ licenseCode, rightsStatus, canBeSharedPublicly, canBeCopiedByOthers }) {
    const normalizedLicenseCode = normalizeLicenseCode(licenseCode, CASE_DEFAULT_LICENSE);
    const normalizedRightsStatus = normalizeRightsStatus(rightsStatus);
    const isOwnWork = normalizedRightsStatus === OWN_WORK_RIGHTS_STATUS;
    const isClearlyOpen = normalizedRightsStatus === OPEN_LICENSE_RIGHTS_STATUS && isOpenLicenseCode(normalizedLicenseCode);
    const isPublicDomain = normalizedRightsStatus === PUBLIC_DOMAIN_RIGHTS_STATUS;

    const explicitSharedPublicly = parseOptionalBoolean(canBeSharedPublicly);
    const explicitCopiedByOthers = parseOptionalBoolean(canBeCopiedByOthers);

    return {
        canBeSharedPublicly: explicitSharedPublicly === undefined
            ? isOwnWork || isClearlyOpen || isPublicDomain
            : explicitSharedPublicly,
        canBeCopiedByOthers: explicitCopiedByOthers === undefined
            ? isOwnWork || isClearlyOpen || isPublicDomain
            : explicitCopiedByOthers,
    };
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
