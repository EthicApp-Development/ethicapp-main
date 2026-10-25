import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    MAX_CASE_DOCUMENTS,
    addCaseDocument,
    caseDocumentControlKey,
    caseDocumentFieldErrorKeys,
    caseDocumentFromPreview,
    caseDocumentIconClass,
    caseDocumentKeys,
    caseDocumentName,
    caseDocumentSaveErrorKey,
    caseDocumentTypeKey,
    caseDocumentWarningKey,
    caseDocumentsFromCase,
    caseDocumentsPayload,
    checkCaseDocumentKey,
    checkCaseDocumentUrl,
    documentPreviewErrorKey,
    formatDocumentModifiedTime,
    isPublishedCaseDocument,
    moveCaseDocument,
    removeCaseDocument,
} from "../case-documents-form.js";

const DOC_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const SHEET_ID = "1ZyXwVuTsRqPoNmLkJiHgFeDcBa987654";
const FILE_ID = "0B_file-id_0123456789abcdefghij";
const PUBLISHED_ID = "2PACX-1vQ_published-0123456789abcdefghij";

const DOC_URL = `https://docs.google.com/document/d/${DOC_ID}/preview`;
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/preview`;
const FILE_URL = `https://drive.google.com/file/d/${FILE_ID}/preview`;
const PUBLISHED_URL = `https://docs.google.com/document/d/e/${PUBLISHED_ID}/pub`;
const EDIT_URL = `https://docs.google.com/document/d/${DOC_ID}/edit`;
const ACCOUNT_EDIT_URL = `https://docs.google.com/document/u/1/d/${DOC_ID}/edit#heading=h.1`;
const DOC_KEY = `drive_file:${DOC_ID}`;
const SHEET_KEY = `drive_file:${SHEET_ID}`;
const PUBLISHED_KEY = `published:${PUBLISHED_ID}`;

function available(name, mimeType = null, modifiedTime = null) {
    return { status: "available", name, mimeType, modifiedTime };
}

function doc(overrides = {}) {
    return {
        kind:         "drive_file",
        product:      "document",
        id:           DOC_ID,
        resourceKey:  null,
        url:          DOC_URL,
        availability: available("Case notes"),
        ...overrides,
    };
}

function sheet() {
    return doc({
        product:      "spreadsheets",
        id:           SHEET_ID,
        url:          SHEET_URL,
        availability: available("Data"),
    });
}

function published() {
    return doc({
        kind:         "published",
        id:           PUBLISHED_ID,
        url:          PUBLISHED_URL,
        availability: available("Notice"),
    });
}

function manyDocuments(count) {
    return Array.from({ length: count }, (_, index) => {
        const id = `1file${String(index).padStart(3, "0")}_abcdefghijklmnopqrstu`;
        return doc({ id, url: `https://docs.google.com/document/d/${id}/preview` });
    });
}

describe("caseDocumentFromPreview (#793)", () => {
    it("turns a preview response into an available list item", () => {
        assert.deepEqual(caseDocumentFromPreview({
            kind:         "drive_file",
            product:      "file",
            id:           FILE_ID,
            resourceKey:  "key_1",
            url:          `${FILE_URL}?resourcekey=key_1`,
            name:         "Report.pdf",
            mimeType:     "application/pdf",
            modifiedTime: "2026-10-01T12:00:00.000Z",
        }), {
            kind:         "drive_file",
            product:      "file",
            id:           FILE_ID,
            resourceKey:  "key_1",
            url:          `${FILE_URL}?resourcekey=key_1`,
            availability: available("Report.pdf", "application/pdf", "2026-10-01T12:00:00.000Z"),
        });
    });

    it("keeps published previews without MIME type or date", () => {
        const item = caseDocumentFromPreview({
            kind:         "published",
            product:      "document",
            id:           PUBLISHED_ID,
            resourceKey:  null,
            url:          PUBLISHED_URL,
            name:         "Notice",
            mimeType:     null,
            modifiedTime: null,
        });
        assert.deepEqual(item.availability, available("Notice"));
        assert.equal(isPublishedCaseDocument(item), true);
        assert.equal(isPublishedCaseDocument(doc()), false);
    });
});

describe("caseDocumentsFromCase (#793)", () => {
    it("orders the documents of GET /cases/:id by position and keeps null availability", () => {
        const documents = caseDocumentsFromCase({
            documents: [
                {
                    kind:         "drive_file",
                    product:      "spreadsheets",
                    id:           SHEET_ID,
                    resourceKey:  null,
                    position:     2,
                    url:          SHEET_URL,
                    availability: null,
                },
                {
                    kind:         "drive_file",
                    product:      "document",
                    id:           DOC_ID,
                    resourceKey:  null,
                    position:     1,
                    url:          DOC_URL,
                    availability: { status: "not_public", name: null },
                },
                { kind: 3, id: "broken" },
            ],
        });

        assert.deepEqual(documents.map(item => item.id), [DOC_ID, SHEET_ID]);
        assert.equal(documents[0].availability.status, "not_public");
        assert.equal(documents[1].availability, null);
        assert.equal("position" in documents[0], false);
    });

    it("returns an empty list for cases without documents", () => {
        assert.deepEqual(caseDocumentsFromCase({}), []);
        assert.deepEqual(caseDocumentsFromCase(null), []);
    });
});

describe("checkCaseDocumentUrl (#793)", () => {
    it("accepts a new Google document link", () => {
        assert.deepEqual(
            checkCaseDocumentUrl([sheet()], ` ${EDIT_URL}?usp=sharing `),
            { ok: true, key: DOC_KEY }
        );
    });

    it("refuses links that are not Google document links", () => {
        for (const url of ["", "not a url", "https://example.com/doc",
            "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz"]) {
            assert.deepEqual(checkCaseDocumentUrl([], url),
                { ok: false, errorKey: "case_documents_error_invalid_url" });
        }
    });

    it("refuses a document already in the list, whatever the link form", () => {
        assert.deepEqual(
            checkCaseDocumentUrl([doc()], ACCOUNT_EDIT_URL),
            { ok: false, errorKey: "case_documents_error_duplicate" }
        );
        assert.deepEqual(
            checkCaseDocumentUrl([published()], `${PUBLISHED_URL}?embedded=true`),
            { ok: false, errorKey: "case_documents_error_duplicate" }
        );
    });

    it("refuses new documents once the list is full", () => {
        const full = manyDocuments(MAX_CASE_DOCUMENTS);
        assert.equal(full.length, 20);
        assert.deepEqual(checkCaseDocumentUrl(full, DOC_URL),
            { ok: false, errorKey: "case_documents_error_too_many" });
        assert.deepEqual(checkCaseDocumentKey(full.slice(1), DOC_KEY),
            { ok: true, key: DOC_KEY });
    });
});

describe("list operations (#793)", () => {
    it("appends new documents and ignores duplicates and a full list", () => {
        const list = addCaseDocument([doc()], sheet());
        assert.deepEqual(caseDocumentKeys(list), [DOC_KEY, SHEET_KEY]);
        assert.equal(addCaseDocument(list, doc()), list);
        const full = manyDocuments(MAX_CASE_DOCUMENTS);
        assert.equal(addCaseDocument(full, doc()), full);
        assert.deepEqual(caseDocumentKeys(addCaseDocument(undefined, doc())), [DOC_KEY]);
    });

    it("moves and removes documents", () => {
        const list = [doc(), sheet(), published()];
        assert.deepEqual(moveCaseDocument(list, 2, -1).map(item => item.id),
            [DOC_ID, PUBLISHED_ID, SHEET_ID]);
        assert.equal(moveCaseDocument(list, 0, -1), list);
        assert.deepEqual(removeCaseDocument(list, 1).map(item => item.id), [DOC_ID, PUBLISHED_ID]);
    });

    it("builds element ids from the kind and id", () => {
        assert.equal(caseDocumentControlKey(doc()), `drive_file-${DOC_ID}`);
        assert.equal(caseDocumentControlKey(published()), `published-${PUBLISHED_ID}`);
        assert.match(caseDocumentControlKey(published()), /^[A-Za-z0-9_-]+$/u);
    });
});

describe("caseDocumentsPayload (#793)", () => {
    it("leaves the field out when the ordered keys are unchanged", () => {
        const list = [doc(), sheet()];
        assert.equal(caseDocumentsPayload(list, caseDocumentKeys(list)), null);
    });

    it("leaves the field out for a new case without documents", () => {
        assert.equal(caseDocumentsPayload([], []), null);
        assert.equal(caseDocumentsPayload(undefined), null);
    });

    it("sends the ordered canonical URLs when documents are added, moved or removed", () => {
        const initial = caseDocumentKeys([doc(), sheet()]);
        assert.deepEqual(caseDocumentsPayload([doc(), sheet(), published()], initial),
            [DOC_URL, SHEET_URL, PUBLISHED_URL]);
        assert.deepEqual(caseDocumentsPayload([sheet(), doc()], initial), [SHEET_URL, DOC_URL]);
        assert.deepEqual(caseDocumentsPayload([], initial), []);
        assert.deepEqual(caseDocumentsPayload([doc()], []), [DOC_URL]);
    });
});

describe("documentPreviewErrorKey (#793)", () => {
    it("maps every preview error code to its message", () => {
        for (const code of ["invalid_url", "not_public", "not_found", "not_configured",
            "unavailable", "throttled"]) {
            assert.equal(documentPreviewErrorKey({ status: 400, data: { status: "err", code } }),
                `case_documents_error_${code}`);
        }
    });

    it("treats a 429 without a code as throttled, and anything else as a failure", () => {
        assert.equal(documentPreviewErrorKey({ status: 429 }), "case_documents_error_throttled");
        assert.equal(documentPreviewErrorKey({ status: 500, data: { code: "toString" } }),
            "case_documents_error_preview_failed");
        assert.equal(documentPreviewErrorKey(null), "case_documents_error_preview_failed");
    });
});

describe("case save errors (#793)", () => {
    it("maps CASE_DOCUMENTS_* codes to messages and leaves other codes alone", () => {
        assert.equal(caseDocumentSaveErrorKey({ data: { code: "CASE_DOCUMENTS_INVALID" } }),
            "case_documents_save_invalid");
        assert.equal(caseDocumentSaveErrorKey({ data: { code: "CASE_DOCUMENTS_REJECTED" } }),
            "case_documents_save_rejected");
        assert.equal(caseDocumentSaveErrorKey({ data: { code: "CASE_DOCUMENTS_NOT_CONFIGURED" } }),
            "case_documents_save_not_configured");
        assert.equal(caseDocumentSaveErrorKey({ data: { code: "CASE_DOCUMENTS_UNAVAILABLE" } }),
            "case_documents_save_unavailable");
        assert.equal(caseDocumentSaveErrorKey({ data: { code: "CASE_VIDEOS_INVALID" } }), null);
        assert.equal(caseDocumentSaveErrorKey(undefined), null);
    });

    it("maps the per-document reasons of the fields to document keys", () => {
        const error = {
            data: {
                code:   "CASE_DOCUMENTS_REJECTED",
                fields: {
                    [DOC_URL]:       "not_public",
                    [SHEET_URL]:     "not_found",
                    [PUBLISHED_URL]: "unavailable",
                },
            },
        };
        assert.deepEqual(caseDocumentFieldErrorKeys(error), {
            [DOC_KEY]:       "case_documents_error_not_public",
            [SHEET_KEY]:     "case_documents_error_not_found",
            [PUBLISHED_KEY]: "case_documents_error_unavailable",
        });

        assert.deepEqual(caseDocumentFieldErrorKeys({
            data: {
                code:   "CASE_DOCUMENTS_INVALID",
                fields: { [DOC_URL]: "duplicate", "https://example.com": "invalid_url" },
            },
        }), {
            [DOC_KEY]:             "case_documents_error_duplicate",
            "https://example.com": "case_documents_error_invalid_url",
        });

        assert.deepEqual(caseDocumentFieldErrorKeys({
            data: {
                code:   "CASE_DOCUMENTS_NOT_CONFIGURED",
                fields: { [DOC_URL]: "not_configured" },
            },
        }), { [DOC_KEY]: "case_documents_error_not_configured" });
    });

    it("ignores list-wide fields, unknown reasons and other errors", () => {
        assert.deepEqual(caseDocumentFieldErrorKeys({
            data: { code: "CASE_DOCUMENTS_INVALID", fields: { documents: "too_many" } },
        }), {});
        assert.deepEqual(caseDocumentFieldErrorKeys({
            data: { code: "CASE_DOCUMENTS_REJECTED", fields: { [DOC_URL]: "constructor" } },
        }), {});
        assert.deepEqual(caseDocumentFieldErrorKeys({
            data: { code: "CASE_VIDEOS_REJECTED", fields: { [DOC_URL]: "not_found" } },
        }), {});
        assert.deepEqual(
            caseDocumentFieldErrorKeys({ data: { code: "CASE_DOCUMENTS_INVALID" } }), {});
    });
});

describe("caseDocumentWarningKey (#793)", () => {
    it("warns when Google was not reached and when a document is not public or missing", () => {
        assert.equal(caseDocumentWarningKey(doc({ availability: null })),
            "case_documents_availability_missing");
        assert.equal(caseDocumentWarningKey(doc({ availability: { status: "not_public" } })),
            "case_documents_availability_not_public");
        assert.equal(caseDocumentWarningKey(doc({ availability: { status: "not_found" } })),
            "case_documents_availability_not_found");
        assert.equal(caseDocumentWarningKey(doc()), null);
    });
});

describe("document type, icon and name (#793)", () => {
    it("names Docs, Sheets and Slides by product", () => {
        assert.equal(caseDocumentTypeKey(doc()), "case_documents_type_document");
        assert.equal(caseDocumentIconClass(doc()), "fa-file-word");
        assert.equal(caseDocumentTypeKey(sheet()), "case_documents_type_spreadsheets");
        assert.equal(caseDocumentIconClass(sheet()), "fa-file-excel");
        const slides = doc({ product: "presentation" });
        assert.equal(caseDocumentTypeKey(slides), "case_documents_type_presentation");
        assert.equal(caseDocumentIconClass(slides), "fa-file-powerpoint");
    });

    it("names Drive files by MIME type: PDFs apart, anything else as a file", () => {
        const pdf = doc({
            product:      "file",
            availability: available("Report.pdf", "application/pdf"),
        });
        assert.equal(caseDocumentTypeKey(pdf), "case_documents_type_pdf");
        assert.equal(caseDocumentIconClass(pdf), "fa-file-pdf");
        const image = doc({ product: "file", availability: available("Photo", "image/png") });
        assert.equal(caseDocumentTypeKey(image), "case_documents_type_file");
        assert.equal(caseDocumentIconClass(image), "fa-file");
        const unknown = doc({ product: "file", availability: null });
        assert.equal(caseDocumentIconClass(unknown), "fa-file");
    });

    it("shows the name, or the URL when Google gave none", () => {
        assert.equal(caseDocumentName(doc()), "Case notes");
        assert.equal(caseDocumentName(doc({ availability: null })), DOC_URL);
        const notFound = doc({ availability: { status: "not_found", name: null } });
        assert.equal(caseDocumentName(notFound), DOC_URL);
    });
});

describe("formatDocumentModifiedTime (#793)", () => {
    it("formats a modification time for the app locale", () => {
        const value = "2026-03-05T14:30:00.000Z";
        const english = formatDocumentModifiedTime(value, "en_US", "UTC");
        const spanish = formatDocumentModifiedTime(value, "es_CL", "UTC");
        assert.match(english, /Mar/u);
        assert.match(english, /2026/u);
        assert.match(spanish, /2026/u);
        assert.notEqual(english, spanish);
    });

    it("returns an empty string for unknown or invalid times", () => {
        assert.equal(formatDocumentModifiedTime(null, "en_US"), "");
        assert.equal(formatDocumentModifiedTime("", "en_US"), "");
        assert.equal(formatDocumentModifiedTime("not a date", "en_US"), "");
    });
});
