import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    CASE_DOCUMENT_DISPLAY, CASE_DOCUMENT_TYPE_ICONS, caseDocumentType, caseMaterialDocuments,
} from "../case-document-material.js";

const FILE_ID_A = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const FILE_ID_B = "1ZyXwVuTsRqPoNmLkJiHgFeDcBa987654";
const PUBLISHED_ID = "2PACX-1vQabcdefghijklmnopqrstuvwxyz0123456789";

function availability(overrides = {}) {
    return {
        status:       "available",
        name:         "Informe",
        mimeType:     "application/vnd.google-apps.document",
        modifiedTime: "2026-10-20T12:00:00.000Z",
        ...overrides,
    };
}

function documentUrl(kind, product, id) {
    if (kind === "published") {
        const form = product === "spreadsheets" ? "pubhtml" : "pub";
        return `https://docs.google.com/${product}/d/e/${id}/${form}`;
    }
    return product === "file"
        ? `https://drive.google.com/file/d/${id}/preview`
        : `https://docs.google.com/${product}/d/${id}/preview`;
}

function caseDocument(product, id, position, documentAvailability = availability(),
    kind = "drive_file") {
    return {
        kind,
        product,
        id,
        resourceKey:  null,
        position,
        url:          documentUrl(kind, product, id),
        availability: documentAvailability,
    };
}

function keysOf(documents) {
    return caseMaterialDocuments({ documents }).map(document => document.key);
}

describe("the case's documents as complementary material (#794)", () => {
    it("lists nothing for cases without documents", () => {
        for (const caseObj of [null, undefined, {}, { documents: null }, { documents: [] },
            { documents: "not a list" }]) {
            assert.deepEqual(caseMaterialDocuments(caseObj), [], JSON.stringify(caseObj));
        }
    });

    it("lists the documents in the case's order, keeping the API order for ties", () => {
        const documents = [
            caseDocument("spreadsheets", FILE_ID_B, 3),
            caseDocument("document", FILE_ID_A, 1),
            caseDocument("presentation", PUBLISHED_ID, 2, availability(), "published"),
        ];
        assert.deepEqual(keysOf(documents),
            [`drive_file:${FILE_ID_A}`, `published:${PUBLISHED_ID}`, `drive_file:${FILE_ID_B}`]);

        const unordered = [caseDocument("file", FILE_ID_B, undefined),
            caseDocument("file", FILE_ID_A, undefined)];
        assert.deepEqual(keysOf(unordered), [`drive_file:${FILE_ID_B}`, `drive_file:${FILE_ID_A}`]);
    });

    it("links an available document with its name as plain text", () => {
        const document = caseDocument("document", FILE_ID_A, 1,
            availability({ name: "  <b>Informe</b> " }));
        assert.deepEqual(caseMaterialDocuments({ documents: [document] }), [{
            key:      `drive_file:${FILE_ID_A}`,
            url:      `https://docs.google.com/document/d/${FILE_ID_A}/preview`,
            name:     "<b>Informe</b>",
            linkText: "<b>Informe</b>",
            type:     "document",
            icon:     "fa-file-word",
            display:  CASE_DOCUMENT_DISPLAY.link,
            status:   "available",
        }]);
    });

    it("labels an available document without a name with its URL", () => {
        const document = caseDocument("document", PUBLISHED_ID, 1,
            availability({ name: null, mimeType: null }), "published");
        const [item] = caseMaterialDocuments({ documents: [document] });
        assert.equal(item.name, "");
        assert.equal(item.linkText, `https://docs.google.com/document/d/e/${PUBLISHED_ID}/pub`);
        assert.equal(item.display, CASE_DOCUMENT_DISPLAY.link);
    });

    it("marks documents that are not public or not found as unavailable", () => {
        for (const status of ["not_public", "not_found"]) {
            const document = caseDocument("spreadsheets", FILE_ID_A, 1,
                { status, name: null, mimeType: null, modifiedTime: null });
            const [item] = caseMaterialDocuments({ documents: [document] });
            assert.equal(item.display, CASE_DOCUMENT_DISPLAY.unavailable, status);
            assert.equal(item.status, status);
            assert.equal(item.name, "");
            assert.equal(item.url, `https://docs.google.com/spreadsheets/d/${FILE_ID_A}/preview`);
        }
    });

    it("marks documents of unknown availability as unverified, labeled with their URL", () => {
        for (const documentAvailability of [null, "available", { status: "unavailable" },
            { status: "not_configured" }, {}]) {
            const document = caseDocument("presentation", FILE_ID_A, 1, documentAvailability);
            const [item] = caseMaterialDocuments({ documents: [document] });
            const label = JSON.stringify(documentAvailability);
            assert.equal(item.display, CASE_DOCUMENT_DISPLAY.unverified, label);
            assert.equal(item.status, null, label);
            assert.equal(item.linkText, item.url, label);
            assert.equal(item.url, `https://docs.google.com/presentation/d/${FILE_ID_A}/preview`);
        }
    });

    it("keeps the API's canonical URL, with its resource key", () => {
        const document = {
            ...caseDocument("file", FILE_ID_A, 1),
            resourceKey: "0-AbC_d",
            url:         `https://drive.google.com/file/d/${FILE_ID_A}/preview?resourcekey=0-AbC_d`,
        };
        assert.equal(caseMaterialDocuments({ documents: [document] })[0].url, document.url);
    });

    it("leaves out entries whose URL is not a canonical Google document URL, and repeats", () => {
        const valid = caseDocument("document", FILE_ID_A, 9);
        const withUrl = (position, url) => ({
            ...caseDocument("document", FILE_ID_B, position), url,
        });
        const documents = [
            withUrl(1, "javascript:alert(1)"),
            withUrl(2, `https://docs.google.com/document/d/${FILE_ID_B}/edit`),
            withUrl(3, `http://docs.google.com/document/d/${FILE_ID_B}/preview`),
            withUrl(4, `https://evil.example/document/d/${FILE_ID_B}/preview`),
            withUrl(5, null),
            null,
            "text",
            valid,
            { ...valid, position: 10 },
        ];
        assert.deepEqual(caseMaterialDocuments({ documents }).map(document => document.url),
            [valid.url]);
    });

    it("picks the type and icon by product, and by MIME type for other Drive files", () => {
        const cases = [
            ["document", null, "document"],
            ["spreadsheets", null, "spreadsheet"],
            ["presentation", null, "presentation"],
            ["file", "application/pdf", "pdf"],
            ["file", "image/png", "file"],
            ["file", null, "file"],
            ["file", undefined, "file"],
        ];
        for (const [product, mimeType, type] of cases) {
            assert.equal(caseDocumentType(product, mimeType), type, `${product} ${mimeType}`);
        }
        assert.deepEqual(CASE_DOCUMENT_TYPE_ICONS, {
            document:     "fa-file-word",
            spreadsheet:  "fa-file-excel",
            presentation: "fa-file-powerpoint",
            pdf:          "fa-file-pdf",
            file:         "fa-file",
        });

        const pdf = caseDocument("file", FILE_ID_A, 1,
            availability({ mimeType: "application/pdf" }));
        const unknownFile = caseDocument("file", FILE_ID_B, 2, null);
        assert.deepEqual(caseMaterialDocuments({ documents: [pdf, unknownFile] })
            .map(document => [document.type, document.icon]),
        [["pdf", "fa-file-pdf"], ["file", "fa-file"]]);
    });

    it("takes the product from the URL, which the API builds from it", () => {
        const document = { ...caseDocument("spreadsheets", FILE_ID_A, 1), product: "document" };
        assert.equal(caseMaterialDocuments({ documents: [document] })[0].type, "spreadsheet");
    });
});
