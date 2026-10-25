// Case document routes (#791, epic #789): whether Google document support is
// configured, and a throttled preview of a pasted Google Docs, Sheets, Slides
// or Drive link for the case form.
//
// Mounted before the cases router, which would otherwise take
// /cases/documents/... as /cases/:id.

import express from "express";
import { requireRole } from "../helpers/auth-helper.js";
import { createSlidingWindowThrottle } from "../helpers/sliding-window-throttle.js";
import {
    canonicalGoogleDocumentUrl,
    googleDocumentKey,
    parseGoogleDocumentUrl,
} from "../../common/modules/google-document-urls.js";
import googleDocumentAvailability, {
    DOCUMENT_STATUS,
} from "../services/google-document-availability.service.js";

const MAX_URL_LENGTH = 2048;

// Error responses of POST /cases/documents/preview. `code` is what clients map
// to translations (`case_documents_error_<code>`, #793); `message` is a
// fallback in English.
export const PREVIEW_ERRORS = Object.freeze({
    invalid_url: {
        status:  400,
        message: "The URL is not a Google Docs, Sheets, Slides or Drive file link.",
    },
    not_public: {
        status:  422,
        message: "The document is not public. Share it as \"Anyone with the link\""
            + " or publish it to the web, then try again.",
    },
    not_found: {
        status:  404,
        message: "The document does not exist or was deleted.",
    },
    not_configured: {
        status:  503,
        message: "Document support is not configured in this installation.",
    },
    unavailable: {
        status:  503,
        message: "Google could not be reached. Try again later.",
    },
    throttled: {
        status:  429,
        message: "Too many document lookups. Try again in a minute.",
    },
});

const ERROR_BY_STATUS = Object.freeze({
    [DOCUMENT_STATUS.NOT_PUBLIC]:     "not_public",
    [DOCUMENT_STATUS.NOT_FOUND]:      "not_found",
    [DOCUMENT_STATUS.UNAVAILABLE]:    "unavailable",
    [DOCUMENT_STATUS.NOT_CONFIGURED]: "not_configured",
});

function previewError(res, code) {
    const { status, message } = PREVIEW_ERRORS[code];
    return res.status(status).json({ status: "err", code, message });
}

/** The parts of a pasted Google document link, or null when it is not one. */
export function documentFromInput(url) {
    return typeof url === "string" && url.length <= MAX_URL_LENGTH
        ? parseGoogleDocumentUrl(url)
        : null;
}

/**
 * The outcome of previewing a document, always checked live (the check
 * refreshes the cache): `{ status, body }` for an available document, or
 * `{ code }` naming one of PREVIEW_ERRORS. The body's `product` is the one the
 * check returns, which may refine a plain Drive link to Docs, Sheets or
 * Slides, and `url` is the canonical opening URL for that product.
 */
export async function previewDocument(parsed, availabilityService) {
    const entries = await availabilityService.checkDocuments([parsed], { useCache: false });
    const entry = entries.get(googleDocumentKey(parsed));
    if (entry?.status !== DOCUMENT_STATUS.AVAILABLE) {
        return { code: ERROR_BY_STATUS[entry?.status] ?? "unavailable" };
    }
    const document = { ...parsed, product: entry.product ?? parsed.product };
    return {
        status: 200,
        body:   {
            kind:         document.kind,
            product:      document.product,
            id:           document.id,
            resourceKey:  document.resourceKey ?? null,
            url:          canonicalGoogleDocumentUrl(document),
            name:         entry.name,
            mimeType:     entry.mimeType ?? null,
            modifiedTime: entry.modifiedTime ?? null,
        },
    };
}

/**
 * The case document router. `availabilityService` is
 * { isConfigured(), checkDocuments(parsedList, options) }; `throttle` is
 * { tryAcquire(key) }, keyed by teacher.
 */
export function createCaseDocumentsRouter({
    availabilityService = googleDocumentAvailability,
    throttle = createSlidingWindowThrottle(),
} = {}) {
    const router = express.Router();

    router.get("/cases/documents/support", (req, res) => {
        if (!requireRole(req, res, "P")) {
            return;
        }
        return res.json({ enabled: availabilityService.isConfigured() });
    });

    router.post("/cases/documents/preview", async (req, res) => {
        if (!requireRole(req, res, "P")) {
            return;
        }
        if (!availabilityService.isConfigured()) {
            return previewError(res, "not_configured");
        }
        const parsed = documentFromInput(req.body?.url);
        if (!parsed) {
            return previewError(res, "invalid_url");
        }

        const { allowed, retryAfterMs } = throttle.tryAcquire(String(req.session.uid));
        if (!allowed) {
            res.set("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
            return previewError(res, "throttled");
        }

        try {
            const outcome = await previewDocument(parsed, availabilityService);
            if (outcome.code) {
                return previewError(res, outcome.code);
            }
            return res.status(outcome.status).json(outcome.body);
        } catch (error) {
            console.error("[case-documents] Preview failed:", error?.message);
            return previewError(res, "unavailable");
        }
    });

    return router;
}

export default createCaseDocumentsRouter();
