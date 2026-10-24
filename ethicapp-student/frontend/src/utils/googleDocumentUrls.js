// Google document URLs (#791, epic #789): recognizing the Google Docs, Sheets,
// Slides and Drive links teachers paste, and building the only URLs EthicApp
// itself opens. Every URL EthicApp shows or opens is rebuilt from validated
// parts (kind, product, id, resource key), never taken as typed. The opening
// URLs are the ones spike #790 chose: /preview for link-shared files, and
// Google's own published form for documents published to the web.
//
// This module imports nothing. ethicapp-student builds separately and keeps a
// byte-identical copy (src/utils/googleDocumentUrls.js), which its tests
// compare with this one.

/** How a document is shared: a Drive file id, or a "published to the web" id. */
export const GOOGLE_DOCUMENT_KINDS = Object.freeze(["drive_file", "published"]);

/** The Google product a document belongs to; `file` is any other Drive file. */
export const GOOGLE_DOCUMENT_PRODUCTS = Object.freeze([
    "document", "spreadsheets", "presentation", "file",
]);

const FILE_ID = /^[A-Za-z0-9_-]{20,128}$/u;
const PUBLISHED_ID = /^2PACX-[A-Za-z0-9_-]{20,200}$/u;
const RESOURCE_KEY = /^[A-Za-z0-9_-]{1,128}$/u;
const ACCOUNT_INDEX = /^\d+$/u;

const DOCS_HOST = "docs.google.com";
const DRIVE_HOST = "drive.google.com";
// Products that live under docs.google.com/<product>/d/...
const DOCS_PRODUCTS = new Set(["document", "spreadsheets", "presentation"]);
// The last path segment of a published link: /d/e/<id>/pub, /pubhtml, /embed.
const PUBLISHED_FORMS = new Set(["pub", "pubhtml", "embed"]);
// The opening form of a published link, per product (#790).
const PUBLISHED_OPENING_FORMS = Object.freeze({
    document:     "pub",
    spreadsheets: "pubhtml",
    presentation: "pub",
});

const MIME_TYPE_PRODUCTS = Object.freeze({
    "application/vnd.google-apps.document":     "document",
    "application/vnd.google-apps.spreadsheet":  "spreadsheets",
    "application/vnd.google-apps.presentation": "presentation",
});

function parseUrl(value) {
    if (typeof value !== "string") {
        return null;
    }
    try {
        const url = new URL(value.trim());
        return url.protocol === "https:" || url.protocol === "http:" ? url : null;
    } catch {
        return null;
    }
}

function pathSegments(url) {
    return url.pathname.split("/").filter(Boolean);
}

function isResourceKey(value) {
    return typeof value === "string" && RESOURCE_KEY.test(value);
}

/**
 * A Drive file result, with the `resourcekey` query parameter when the link
 * carries one. A resource key that is present but malformed makes the whole
 * link invalid instead of being dropped: opening the file without the key the
 * teacher pasted would fail for readers in a way the teacher cannot see.
 */
function driveFile(url, product, id) {
    if (typeof id !== "string" || !FILE_ID.test(id)) {
        return null;
    }
    const resourceKey = url.searchParams.get("resourcekey");
    if (resourceKey !== null && !isResourceKey(resourceKey)) {
        return null;
    }
    return { kind: "drive_file", product, id, resourceKey };
}

function parseDocsPath(url) {
    let segments = pathSegments(url);
    // Links copied while signed in to several accounts: /u/<n>/document/d/...
    if (segments[0] === "u" && ACCOUNT_INDEX.test(segments[1] ?? "")) {
        segments = segments.slice(2);
    }
    const [product, d, idOrE, publishedId, form] = segments;
    if (!DOCS_PRODUCTS.has(product) || d !== "d") {
        return null;
    }
    if (idOrE === "e") {
        if (!PUBLISHED_ID.test(publishedId ?? "") || !PUBLISHED_FORMS.has(form)) {
            return null;
        }
        return { kind: "published", product, id: publishedId, resourceKey: null };
    }
    return driveFile(url, product, idOrE);
}

function parseDrivePath(url) {
    const segments = pathSegments(url);
    if (segments[0] === "file" && segments[1] === "d") {
        return driveFile(url, "file", segments[2]);
    }
    if (segments.length === 1 && segments[0] === "open") {
        return driveFile(url, "file", url.searchParams.get("id"));
    }
    return null;
}

/**
 * The parts of a Google document link, or null. Accepted forms:
 * - docs.google.com/{document,spreadsheets,presentation}/d/<id>/..., also
 *   with a /u/<n>/ prefix: a `drive_file` of that product;
 * - drive.google.com/file/d/<id>/... and drive.google.com/open?id=<id>: a
 *   `drive_file` of product `file`;
 * - docs.google.com/{document,spreadsheets,presentation}/d/e/<id>/
 *   {pub,pubhtml,embed}...: a `published` document of that product.
 * Only http and https are accepted. Folders, other hosts and malformed ids
 * are not. Unrelated query parameters (usp, tab, gid, ...) are ignored.
 *
 * Returns `{ kind, product, id, resourceKey }`, where `resourceKey` is the
 * `resourcekey` query parameter of a `drive_file` link, or null.
 */
export function parseGoogleDocumentUrl(value) {
    const url = parseUrl(value);
    if (!url) {
        return null;
    }
    const host = url.hostname.toLowerCase();
    if (host === DOCS_HOST) {
        return parseDocsPath(url);
    }
    if (host === DRIVE_HOST) {
        return parseDrivePath(url);
    }
    return null;
}

function assertValidParts(parsed) {
    if (parsed === null || typeof parsed !== "object") {
        throw new TypeError("Invalid Google document.");
    }
    const { kind, product, id, resourceKey } = parsed;
    if (!GOOGLE_DOCUMENT_KINDS.includes(kind)) {
        throw new TypeError("Invalid Google document kind.");
    }
    if (!GOOGLE_DOCUMENT_PRODUCTS.includes(product)) {
        throw new TypeError("Invalid Google document product.");
    }
    const idPattern = kind === "published" ? PUBLISHED_ID : FILE_ID;
    if (typeof id !== "string" || !idPattern.test(id)) {
        throw new TypeError("Invalid Google document id.");
    }
    if (resourceKey != null && !isResourceKey(resourceKey)) {
        throw new TypeError("Invalid Google document resource key.");
    }
    if (kind === "published" && (product === "file" || resourceKey != null)) {
        throw new TypeError("A published Google document has no file product or resource key.");
    }
}

/**
 * The URL EthicApp opens for a parsed Google document (#790):
 * - a `drive_file` opens in /preview, on drive.google.com for product `file`
 *   and on docs.google.com otherwise, with `?resourcekey=<key>` when present;
 * - a `published` document opens in Google's own published form: /pub for
 *   documents and presentations, /pubhtml for spreadsheets.
 * Throws a TypeError when the parts are not valid.
 */
export function canonicalGoogleDocumentUrl(parsed) {
    assertValidParts(parsed);
    const { kind, product, id, resourceKey } = parsed;
    if (kind === "published") {
        return `https://${DOCS_HOST}/${product}/d/e/${id}/${PUBLISHED_OPENING_FORMS[product]}`;
    }
    const base = product === "file"
        ? `https://${DRIVE_HOST}/file/d/${id}/preview`
        : `https://${DOCS_HOST}/${product}/d/${id}/preview`;
    return resourceKey == null
        ? base
        : `${base}?resourcekey=${encodeURIComponent(resourceKey)}`;
}

/**
 * The identity of a parsed Google document, "<kind>:<id>": what duplicates,
 * the availability cache and joins compare.
 */
export function googleDocumentKey(parsed) {
    return `${parsed.kind}:${parsed.id}`;
}

/**
 * The product of a Drive file from its MIME type: Google Docs, Sheets and
 * Slides map to their product, and anything else (PDFs, images, ...) to `file`.
 */
export function productFromMimeType(mimeType) {
    return typeof mimeType === "string" && Object.hasOwn(MIME_TYPE_PRODUCTS, mimeType)
        ? MIME_TYPE_PRODUCTS[mimeType]
        : "file";
}
