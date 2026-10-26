// The case's Google Drive documents as complementary material, after its
// videos (#794, epic #789): pure helpers for the teacher's case page and
// activity case tab.
import {
    canonicalGoogleDocumentUrl, googleDocumentKey, parseGoogleDocumentUrl,
} from "../../../../common/modules/google-document-urls.js";

/**
 * How a listed document is shown:
 * - `link`: Google reports it available; its link, labeled with its name;
 * - `unavailable`: Google reports it not public or not found; a warning with
 *   how to fix its sharing, and its link for the teacher to check it;
 * - `unverified`: its availability is unknown (Google unreachable, or document
 *   support not configured); its link, labeled with its URL, and a notice.
 */
export const CASE_DOCUMENT_DISPLAY = Object.freeze({
    link:        "link",
    unavailable: "unavailable",
    unverified:  "unverified",
});

const UNAVAILABLE_STATUSES = new Set(["not_public", "not_found"]);

/**
 * The type of a document, which picks its icon and its visually hidden name:
 * Google Docs, Sheets and Slides by product, and other Drive files as `pdf`
 * when their MIME type says so, or `file` otherwise.
 */
const PRODUCT_TYPES = Object.freeze({
    document:     "document",
    spreadsheets: "spreadsheet",
    presentation: "presentation",
});

/** The Font Awesome 6 solid icon of each document type. */
export const CASE_DOCUMENT_TYPE_ICONS = Object.freeze({
    document:     "fa-file-word",
    spreadsheet:  "fa-file-excel",
    presentation: "fa-file-powerpoint",
    pdf:          "fa-file-pdf",
    file:         "fa-file",
});

/** The type of a document, from its product and, for Drive files, its MIME type. */
export function caseDocumentType(product, mimeType) {
    if (Object.hasOwn(PRODUCT_TYPES, product)) {
        return PRODUCT_TYPES[product];
    }
    return mimeType === "application/pdf" ? "pdf" : "file";
}

function trimmedText(value) {
    return typeof value === "string" ? value.trim() : "";
}

/**
 * The parts of an opening URL from the API, when it is the canonical URL of a
 * Google document; null for anything else. The URL is used as the API sent
 * it, and this only keeps a malformed or foreign value out of an href.
 */
function canonicalDocumentParts(url) {
    const parsed = parseGoogleDocumentUrl(url);
    if (!parsed) {
        return null;
    }
    try {
        return canonicalGoogleDocumentUrl(parsed) === url ? parsed : null;
    } catch {
        return null;
    }
}

function displayOf(availability) {
    if (availability?.status === "available") {
        return CASE_DOCUMENT_DISPLAY.link;
    }
    if (UNAVAILABLE_STATUSES.has(availability?.status)) {
        return CASE_DOCUMENT_DISPLAY.unavailable;
    }
    return CASE_DOCUMENT_DISPLAY.unverified;
}

function documentEntries(caseObj) {
    const documents = caseObj?.documents;
    if (!Array.isArray(documents)) {
        return [];
    }
    return documents
        .map((document, index) => ({ document, index }))
        .filter(({ document }) => document && typeof document === "object")
        .sort((left, right) => (
            (Number(left.document.position) - Number(right.document.position))
            || (left.index - right.index)
        ))
        .map(({ document }) => document);
}

/**
 * The case's documents (`GET /cases/:id`), in the case's order, as the
 * material section lists them. Entries whose `url` is not a canonical Google
 * document URL are left out, and so are repeats.
 *
 * Each item is `{ key, url, name, linkText, type, icon, display, status }`:
 * - `url` is the API's opening URL, as sent;
 * - `name` is the document's name as Google reports it, plain text, or an
 *   empty string when unknown; `linkText` is the name, or the URL without one;
 * - `type` and `icon` come from `caseDocumentType` and
 *   `CASE_DOCUMENT_TYPE_ICONS`;
 * - `display` is one of `CASE_DOCUMENT_DISPLAY`;
 * - `status` is the reported availability status, or null when unknown.
 */
export function caseMaterialDocuments(caseObj) {
    const seenKeys = new Set();
    return documentEntries(caseObj)
        .map(document => {
            const parsed = canonicalDocumentParts(document.url);
            if (!parsed) {
                return null;
            }
            const availability = document.availability && typeof document.availability === "object"
                ? document.availability
                : null;
            const display = displayOf(availability);
            const type = caseDocumentType(parsed.product, availability?.mimeType);
            const name = trimmedText(availability?.name);
            return {
                key:      googleDocumentKey(parsed),
                url:      document.url,
                name,
                linkText: name || document.url,
                type,
                icon:     CASE_DOCUMENT_TYPE_ICONS[type],
                display,
                status:   display === CASE_DOCUMENT_DISPLAY.unverified ? null : availability.status,
            };
        })
        .filter(document => {
            if (!document || seenKeys.has(document.key)) {
                return false;
            }
            seenKeys.add(document.key);
            return true;
        });
}
