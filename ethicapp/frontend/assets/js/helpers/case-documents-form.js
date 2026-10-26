// The case form's attached documents (#793, epic #789): pure helpers for the
// teacher case form. They shape the documents of `GET /cases/:id` and of the
// preview endpoint into list items, edit the ordered list, build the
// `documents` field the case API takes, map API error codes to translation
// keys, and name each document's type and icon.
//
// A list item is `{ kind, product, id, resourceKey, url, availability }`,
// where `url` is the canonical opening URL and `availability` is
// `{ status, name, mimeType, modifiedTime }`, or null when Google could not be
// reached.
import {
    googleDocumentKey,
    parseGoogleDocumentUrl,
} from "../../../../common/modules/google-document-urls.js";
import { moveListItem, removeListItem, sameOrderedKeys } from "./ordered-list.js";

/** At most this many documents per case, as the case API enforces. */
export const MAX_CASE_DOCUMENTS = 20;

const PDF_MIME_TYPE = "application/pdf";

const PREVIEW_ERROR_KEYS = Object.freeze({
    invalid_url:    "case_documents_error_invalid_url",
    not_public:     "case_documents_error_not_public",
    not_found:      "case_documents_error_not_found",
    not_configured: "case_documents_error_not_configured",
    unavailable:    "case_documents_error_unavailable",
    throttled:      "case_documents_error_throttled",
});

const SAVE_ERROR_KEYS = Object.freeze({
    CASE_DOCUMENTS_INVALID:        "case_documents_save_invalid",
    CASE_DOCUMENTS_REJECTED:       "case_documents_save_rejected",
    CASE_DOCUMENTS_NOT_CONFIGURED: "case_documents_save_not_configured",
    CASE_DOCUMENTS_UNAVAILABLE:    "case_documents_save_unavailable",
});

// Per-document reasons in `fields` of a CASE_DOCUMENTS_* save error.
const FIELD_ERROR_KEYS = Object.freeze({
    invalid_url:    "case_documents_error_invalid_url",
    duplicate:      "case_documents_error_duplicate",
    not_public:     "case_documents_error_not_public",
    not_found:      "case_documents_error_not_found",
    not_configured: "case_documents_error_not_configured",
    unavailable:    "case_documents_error_unavailable",
});

// Fields of a save error about the whole list rather than one document.
const LIST_FIELD = "documents";

const AVAILABILITY_WARNING_KEYS = Object.freeze({
    not_public: "case_documents_availability_not_public",
    not_found:  "case_documents_availability_not_found",
});

const PRODUCT_TYPES = Object.freeze({
    document:     { typeKey: "case_documents_type_document", iconClass: "fa-file-word" },
    spreadsheets: { typeKey: "case_documents_type_spreadsheets", iconClass: "fa-file-excel" },
    presentation: { typeKey: "case_documents_type_presentation", iconClass: "fa-file-powerpoint" },
});
const PDF_TYPE = Object.freeze({ typeKey: "case_documents_type_pdf", iconClass: "fa-file-pdf" });
const FILE_TYPE = Object.freeze({ typeKey: "case_documents_type_file", iconClass: "fa-file" });

function normalizeAvailability(availability) {
    if (!availability || typeof availability !== "object") {
        return null;
    }

    return {
        status:       availability.status ?? null,
        name:         availability.name ?? null,
        mimeType:     availability.mimeType ?? null,
        modifiedTime: availability.modifiedTime ?? null,
    };
}

/**
 * The list item of a `POST /cases/documents/preview` response, which only
 * describes available documents.
 */
export function caseDocumentFromPreview(preview) {
    return {
        kind:         preview.kind,
        product:      preview.product,
        id:           preview.id,
        resourceKey:  preview.resourceKey ?? null,
        url:          preview.url,
        availability: normalizeAvailability({
            status:       "available",
            name:         preview.name,
            mimeType:     preview.mimeType,
            modifiedTime: preview.modifiedTime,
        }),
    };
}

/** The ordered list items of the `documents` of `GET /cases/:id`. */
export function caseDocumentsFromCase(caseObj) {
    if (!Array.isArray(caseObj?.documents)) {
        return [];
    }

    return caseObj.documents
        .filter(document => typeof document?.kind === "string" && typeof document?.id === "string")
        .slice()
        .sort((left, right) => Number(left.position) - Number(right.position))
        .map(document => ({
            kind:         document.kind,
            product:      document.product,
            id:           document.id,
            resourceKey:  document.resourceKey ?? null,
            url:          document.url || "",
            availability: normalizeAvailability(document.availability),
        }));
}

/** The identities ("<kind>:<id>") of the list, in order. */
export function caseDocumentKeys(documents) {
    return Array.isArray(documents) ? documents.map(googleDocumentKey) : [];
}

/**
 * A part of an element id for a document, "<kind>-<id>": kinds, file ids and
 * published ids only hold letters, digits, "_" and "-".
 */
export function caseDocumentControlKey(document) {
    return `${document.kind}-${document.id}`;
}

/** Whether a document with `key` can join the list: not a duplicate, within the limit. */
export function checkCaseDocumentKey(documents, key) {
    const keys = caseDocumentKeys(documents);
    if (keys.includes(key)) {
        return { ok: false, errorKey: "case_documents_error_duplicate" };
    }
    if (keys.length >= MAX_CASE_DOCUMENTS) {
        return { ok: false, errorKey: "case_documents_error_too_many" };
    }
    return { ok: true, key };
}

/**
 * Checks a pasted URL before asking for its preview. Returns `{ ok: true, key }`,
 * or `{ ok: false, errorKey }` when the URL is not a Google document link, the
 * document is already in the list (whatever form its link takes), or the list
 * is full.
 */
export function checkCaseDocumentUrl(documents, url) {
    const parsed = parseGoogleDocumentUrl(String(url || "").trim());
    if (!parsed) {
        return { ok: false, errorKey: PREVIEW_ERROR_KEYS.invalid_url };
    }
    return checkCaseDocumentKey(documents, googleDocumentKey(parsed));
}

/** The list with `document` appended, unless it is a duplicate or the list is full. */
export function addCaseDocument(documents, document) {
    const list = Array.isArray(documents) ? documents : [];
    if (!checkCaseDocumentKey(list, googleDocumentKey(document)).ok) {
        return list;
    }
    return [...list, document];
}

/** The list with the document at `index` moved by `offset` places, when possible. */
export const moveCaseDocument = moveListItem;

/** The list without the document at `index`. */
export const removeCaseDocument = removeListItem;

/**
 * The `documents` field of a case create or update: the ordered canonical
 * URLs, or null when the identities equal `initialKeys` in the same order, so
 * the field is left out and the case API keeps the documents unchanged. A new
 * case starts from no keys, so an empty list sends nothing.
 */
export function caseDocumentsPayload(documents, initialKeys = []) {
    if (sameOrderedKeys(caseDocumentKeys(documents), initialKeys)) {
        return null;
    }
    return (Array.isArray(documents) ? documents : []).map(document => document.url);
}

/** The translation key of a failed preview request. */
export function documentPreviewErrorKey(error) {
    const code = error?.data?.code;
    if (Object.hasOwn(PREVIEW_ERROR_KEYS, code ?? "")) {
        return PREVIEW_ERROR_KEYS[code];
    }
    if (error?.status === 429) {
        return PREVIEW_ERROR_KEYS.throttled;
    }
    return "case_documents_error_preview_failed";
}

/** The translation key of a CASE_DOCUMENTS_* save error, or null for others. */
export function caseDocumentSaveErrorKey(error) {
    const code = error?.data?.code;
    return Object.hasOwn(SAVE_ERROR_KEYS, code ?? "") ? SAVE_ERROR_KEYS[code] : null;
}

/**
 * The per-document translation keys of a CASE_DOCUMENTS_* save error, keyed
 * by document identity ("<kind>:<id>"). `fields` names each document by the
 * URL the form sent; a URL that does not parse keeps the URL as its key.
 * Other errors, and fields about the whole list, give none.
 */
export function caseDocumentFieldErrorKeys(error) {
    const fields = caseDocumentSaveErrorKey(error) ? error.data.fields : null;
    if (!fields || typeof fields !== "object") {
        return {};
    }

    return Object.fromEntries(Object.entries(fields)
        .filter(([url, reason]) => url !== LIST_FIELD && Object.hasOwn(FIELD_ERROR_KEYS, reason))
        .map(([url, reason]) => {
            const parsed = parseGoogleDocumentUrl(url);
            return [parsed ? googleDocumentKey(parsed) : url, FIELD_ERROR_KEYS[reason]];
        }));
}

/**
 * The notice shown for a listed document, or null when it is available:
 * Google could not be reached (no availability), or it reports the document
 * not public or missing.
 */
export function caseDocumentWarningKey(document) {
    const status = document?.availability?.status;
    if (!status) {
        return "case_documents_availability_missing";
    }
    return AVAILABILITY_WARNING_KEYS[status] ?? null;
}

function documentType(document) {
    if (Object.hasOwn(PRODUCT_TYPES, document?.product ?? "")) {
        return PRODUCT_TYPES[document.product];
    }
    return document?.availability?.mimeType === PDF_MIME_TYPE ? PDF_TYPE : FILE_TYPE;
}

/** The translation key of a document's type: Docs, Sheets, Slides, PDF or Drive file. */
export function caseDocumentTypeKey(document) {
    return documentType(document).typeKey;
}

/** The Font Awesome icon class of a document's type. */
export function caseDocumentIconClass(document) {
    return documentType(document).iconClass;
}

/** The name of a document, or its URL when Google gave no name. */
export function caseDocumentName(document) {
    return document?.availability?.name || document?.url || "";
}

/** Whether a document is a link published to the web. */
export function isPublishedCaseDocument(document) {
    return document?.kind === "published";
}

/**
 * A modification time as a date and time for an app locale ("es_CL",
 * "en_US"), or an empty string when it is unknown. `timeZone` defaults to
 * the browser's.
 */
export function formatDocumentModifiedTime(value, appLocale, timeZone) {
    if (!value) {
        return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "";
    }

    const locale = String(appLocale || "en_US").replace("_", "-");
    try {
        return new Intl.DateTimeFormat(locale, {
            dateStyle: "medium",
            timeStyle: "short",
            ...(timeZone ? { timeZone } : {}),
        }).format(date);
    } catch {
        return date.toISOString();
    }
}
