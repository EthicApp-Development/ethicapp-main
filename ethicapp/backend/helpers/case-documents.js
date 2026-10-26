// Public Google documents attached to a case (#792, epic #789).
//
// A case stores only the parts of its ordered documents (ethical_case_documents,
// V20): kind, product, id and resource key. This module parses the URLs a
// teacher submits, checks the new documents against Google before they are
// saved, shapes the documents for the case API and writes or copies the rows.
// Availability comes from the service of #791, which callers inject as
// `availabilityService`, and the queries run on a pg client or pool the caller
// passes. Nothing here connects to PostgreSQL, Redis or Google by itself.
import {
    GOOGLE_DOCUMENT_PRODUCTS,
    canonicalGoogleDocumentUrl,
    googleDocumentKey,
    parseGoogleDocumentUrl,
} from "../../common/modules/google-document-urls.js";

/** At most this many documents per case. */
export const MAX_CASE_DOCUMENTS = 20;

export const CASE_DOCUMENT_ERROR_CODES = Object.freeze({
    invalid:       "CASE_DOCUMENTS_INVALID",
    rejected:      "CASE_DOCUMENTS_REJECTED",
    notConfigured: "CASE_DOCUMENTS_NOT_CONFIGURED",
    unavailable:   "CASE_DOCUMENTS_UNAVAILABLE",
});

// Availability statuses that reject a new document, and that reads report.
const REJECTED_STATUSES = new Set(["not_public", "not_found"]);
const REPORTED_STATUSES = new Set(["available", ...REJECTED_STATUSES]);

/** The stored parts of a document, as the URL module and the service take them. */
function documentParts({ kind, product, id, resourceKey }) {
    return { kind, product, id, resourceKey: resourceKey ?? null };
}

/** The canonical URL of stored parts, or null when they are not valid. */
function canonicalUrlOrNull(parts) {
    try {
        return canonicalGoogleDocumentUrl(parts);
    } catch {
        return null;
    }
}

/**
 * A subquery for the ordered `[{ kind, product, id, resourceKey, position }]`
 * of the case aliased `caseAlias`, as JSON. Listings read it in the same query
 * as the case, so they need neither another query per case nor Google.
 */
export function caseDocumentsJsonSql(caseAlias = "c") {
    return `COALESCE((
        SELECT json_agg(json_build_object(
            'kind', ecd.kind,
            'product', ecd.product,
            'id', ecd.external_id,
            'resourceKey', ecd.resource_key,
            'position', ecd.position
        ) ORDER BY ecd.position)
        FROM ethical_case_documents ecd
        WHERE ecd.case_id = ${caseAlias}.id
    ), '[]'::json)`;
}

/**
 * The documents of listings, searches and copies, from a row's JSON column:
 * `[{ kind, product, id, resourceKey, position, url }]` in order, where `url`
 * is canonical. They carry no availability, so they need no request to Google.
 */
export function normalizeCaseDocumentSummaries(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map(document => {
            const parts = documentParts(document || {});
            const url = canonicalUrlOrNull(parts);
            return url ? { ...parts, position: Number(document.position), url } : null;
        })
        .filter(Boolean)
        .sort((left, right) => left.position - right.position);
}

/** Summaries numbered from 1, in the order of `documents`. */
export function caseDocumentSummariesFromDocuments(documents) {
    return normalizeCaseDocumentSummaries(
        documents.map((document, index) => ({ ...document, position: index + 1 }))
    );
}

function invalidDocuments(fields) {
    return {
        ok:     false,
        status: 400,
        body:   {
            status:  "err",
            message: "Invalid case documents.",
            code:    CASE_DOCUMENT_ERROR_CODES.invalid,
            fields,
        },
    };
}

/**
 * The `documents` field of a case create or update: a JSON array of Google
 * document URLs, in order. Returns `{ ok: true, provided: false }` when the
 * field is absent, which leaves an existing case's documents unchanged, and
 * `{ ok: true, provided: true, documents }` otherwise, where an empty list
 * removes every document. Each document is
 * `{ kind, product, id, resourceKey, url }`, with `url` as sent.
 *
 * Malformed input returns `{ ok: false, status: 400, body }` with code
 * `CASE_DOCUMENTS_INVALID`, where `body.fields` maps `documents` to `invalid`
 * (not a JSON array) or `too_many`, or each URL as sent to `invalid_url` or
 * `duplicate` (a document already listed earlier, by kind and id).
 */
export function parseCaseDocuments(value) {
    if (value === undefined || value === null) {
        return { ok: true, provided: false };
    }

    let parsed = value;
    if (typeof value === "string") {
        try {
            parsed = JSON.parse(value);
        } catch {
            return invalidDocuments({ documents: "invalid" });
        }
    }

    if (!Array.isArray(parsed)) {
        return invalidDocuments({ documents: "invalid" });
    }

    if (parsed.length > MAX_CASE_DOCUMENTS) {
        return invalidDocuments({ documents: "too_many" });
    }

    const fields = {};
    const keys = new Set();
    const documents = [];
    for (const url of parsed) {
        const document = parseGoogleDocumentUrl(url);
        if (!document) {
            fields[String(url)] = "invalid_url";
            continue;
        }
        const key = googleDocumentKey(document);
        if (keys.has(key)) {
            fields[url] = "duplicate";
            continue;
        }
        keys.add(key);
        documents.push({ ...documentParts(document), url });
    }

    if (Object.keys(fields).length > 0) {
        return invalidDocuments(fields);
    }

    return { ok: true, provided: true, documents };
}

/**
 * What saving `requested` does to a case holding `current`, both lists of
 * documents compared by kind and id: the requested documents it adds (the only
 * ones to check on Google), the stored ones it removes, and whether the list
 * changes at all, order included.
 */
export function planCaseDocumentChanges(current, requested) {
    const currentKeys = current.map(googleDocumentKey);
    const requestedKeys = requested.map(googleDocumentKey);
    const currentSet = new Set(currentKeys);
    const requestedSet = new Set(requestedKeys);

    return {
        newDocuments:     requested.filter((_, index) => !currentSet.has(requestedKeys[index])),
        removedDocuments: current.filter((_, index) => !requestedSet.has(currentKeys[index])),
        changed:          currentKeys.length !== requestedKeys.length
            || currentKeys.some((key, index) => key !== requestedKeys[index]),
    };
}

/**
 * The product to store for a new document: a Drive file takes the product the
 * check found from its MIME type (a drive.google.com link may be a Doc, a
 * Sheet or a Slides file); a published document keeps the product of its URL,
 * which Google needs to open it.
 */
function checkedProduct(document, entry) {
    if (document.kind === "drive_file" && GOOGLE_DOCUMENT_PRODUCTS.includes(entry?.product)) {
        return entry.product;
    }
    return document.product;
}

function notConfiguredDocuments(newDocuments) {
    return {
        ok:     false,
        status: 400,
        body:   {
            status:  "err",
            message: "Document support is not configured.",
            code:    CASE_DOCUMENT_ERROR_CODES.notConfigured,
            fields:  Object.fromEntries(
                newDocuments.map(document => [document.url, "not_configured"])
            ),
        },
    };
}

/**
 * Checks, uncached, the documents a case does not hold yet: each must be
 * available to anyone with the link. Documents the case already holds are not
 * checked again, so a case keeps a document whose sharing later changed.
 *
 * Returns `{ ok: true, documents }`, the new documents with the product to
 * store, or `{ ok: false, status, body }` where `body.fields` maps each failing
 * URL, as sent, to its reason:
 * - 400 `CASE_DOCUMENTS_NOT_CONFIGURED` (`not_configured`) without a Google key;
 * - 400 `CASE_DOCUMENTS_REJECTED` (`not_public`, `not_found`);
 * - 503 `CASE_DOCUMENTS_UNAVAILABLE` (`unavailable`) when Google cannot be
 *   reached for some document and none was rejected, so nothing unchecked is
 *   saved.
 */
export async function checkNewCaseDocuments(newDocuments, { availabilityService }) {
    if (newDocuments.length === 0) {
        return { ok: true, documents: [] };
    }

    if (!availabilityService.isConfigured()) {
        return notConfiguredDocuments(newDocuments);
    }

    let entries;
    try {
        entries = await availabilityService.checkDocuments(
            newDocuments.map(documentParts),
            { useCache: false }
        );
    } catch (error) {
        console.error("Unable to check case documents on Google:", error);
        entries = new Map();
    }

    const rejected = {};
    const unavailable = {};
    const checked = [];
    let configured = true;
    for (const document of newDocuments) {
        const entry = entries.get(googleDocumentKey(document));
        if (entry?.status === "not_configured") {
            configured = false;
        } else if (REJECTED_STATUSES.has(entry?.status)) {
            rejected[document.url] = entry.status;
        } else if (entry?.status === "available") {
            checked.push({ ...document, product: checkedProduct(document, entry) });
        } else {
            unavailable[document.url] = "unavailable";
        }
    }

    if (!configured) {
        return notConfiguredDocuments(newDocuments);
    }

    if (Object.keys(rejected).length > 0) {
        return {
            ok:     false,
            status: 400,
            body:   {
                status:  "err",
                message: "Some documents cannot be added to the case.",
                code:    CASE_DOCUMENT_ERROR_CODES.rejected,
                fields:  rejected,
            },
        };
    }

    if (Object.keys(unavailable).length > 0) {
        return {
            ok:     false,
            status: 503,
            body:   {
                status:  "err",
                message: "Google could not be reached to check the documents. Try again.",
                code:    CASE_DOCUMENT_ERROR_CODES.unavailable,
                fields:  unavailable,
            },
        };
    }

    return { ok: true, documents: checked };
}

/**
 * Decides what a case create or update does with its documents, given the
 * parsed `documents` field and the documents the case holds now (none for a
 * new case). Returns `{ ok: true, documents }`, where `documents` is the list
 * of `{ kind, product, id, resourceKey }` to write, or null when the field was
 * absent or the list is unchanged; or the error of `checkNewCaseDocuments`,
 * before anything is written. A kept document keeps its stored parts, product
 * and resource key included, whatever form its URL was sent in.
 */
export async function prepareCaseDocumentSave(parsedDocuments, currentDocuments, services) {
    if (!parsedDocuments.provided) {
        return { ok: true, documents: null };
    }

    const plan = planCaseDocumentChanges(currentDocuments, parsedDocuments.documents);
    const check = await checkNewCaseDocuments(plan.newDocuments, services);
    if (!check.ok) {
        return check;
    }
    if (!plan.changed) {
        return { ok: true, documents: null };
    }

    const byKey = new Map([
        ...currentDocuments.map(document => [googleDocumentKey(document), document]),
        ...check.documents.map(document => [googleDocumentKey(document), document]),
    ]);
    return {
        ok:        true,
        documents: parsedDocuments.documents.map(document => {
            return documentParts(byKey.get(googleDocumentKey(document)));
        }),
    };
}

function availabilityOf(entry) {
    if (!REPORTED_STATUSES.has(entry?.status)) {
        return null;
    }
    const available = entry.status === "available";
    return {
        status:       entry.status,
        name:         available ? entry.name ?? null : null,
        mimeType:     available ? entry.mimeType ?? null : null,
        modifiedTime: available ? entry.modifiedTime ?? null : null,
    };
}

/**
 * The documents of `GET /cases/:id`: each summary gains its `availability`,
 * resolved through the availability service's cache. `availability` is null
 * when Google cannot be reached or document support is not configured.
 */
export async function resolveCaseDocuments(summaries, { availabilityService }) {
    if (summaries.length === 0) {
        return [];
    }

    let entries = new Map();
    if (availabilityService.isConfigured()) {
        try {
            entries = await availabilityService.checkDocuments(
                summaries.map(documentParts),
                { useCache: true }
            );
        } catch (error) {
            console.error("Unable to resolve case document availability:", error);
        }
    }

    return summaries.map(document => ({
        ...document,
        availability: availabilityOf(entries.get(googleDocumentKey(document))),
    }));
}

/**
 * The documents of a case, in order, as `{ kind, product, id, resourceKey }`.
 * `db` is a pg client or pool.
 */
export async function listCaseDocuments(db, caseId) {
    const result = await db.query(`
        SELECT kind, product, external_id, resource_key
        FROM ethical_case_documents
        WHERE case_id = $1
        ORDER BY position;
    `, [caseId]);
    return result.rows.map(row => documentParts({
        kind:        row.kind,
        product:     row.product,
        id:          row.external_id,
        resourceKey: row.resource_key,
    }));
}

/**
 * Replaces a case's documents with `documents`, in order, numbered from 1. Run
 * it inside the caller's transaction so the list never shows half written.
 */
export async function replaceCaseDocuments(db, caseId, documents) {
    await db.query("DELETE FROM ethical_case_documents WHERE case_id = $1;", [caseId]);

    if (documents.length === 0) {
        return;
    }

    await db.query(`
        INSERT INTO ethical_case_documents
            (case_id, position, kind, product, external_id, resource_key)
        SELECT $1, document.position, document.kind, document.product,
               document.external_id, document.resource_key
        FROM unnest($2::text[], $3::text[], $4::text[], $5::text[])
            WITH ORDINALITY AS document (kind, product, external_id, resource_key, position);
    `, [
        caseId,
        documents.map(document => document.kind),
        documents.map(document => document.product),
        documents.map(document => document.id),
        documents.map(document => document.resourceKey ?? null),
    ]);
}

/** Copies the documents of one case to another, keeping their order. */
export async function copyCaseDocuments(db, sourceCaseId, targetCaseId) {
    await db.query(`
        INSERT INTO ethical_case_documents
            (case_id, position, kind, product, external_id, resource_key)
        SELECT $2, ecd.position, ecd.kind, ecd.product, ecd.external_id, ecd.resource_key
        FROM ethical_case_documents ecd
        WHERE ecd.case_id = $1
        ORDER BY ecd.position
        ON CONFLICT (case_id, kind, external_id) DO NOTHING;
    `, [sourceCaseId, targetCaseId]);
}
