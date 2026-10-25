import assert from "node:assert/strict";
import express from "express";
import { describe, it } from "node:test";

import { createSlidingWindowThrottle } from "../../helpers/sliding-window-throttle.js";
import {
    createCaseDocumentsRouter,
    documentFromInput,
    previewDocument,
} from "../case-documents.js";

const FILE_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const PUBLISHED_ID = "2PACX-1vAbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const DOC_URL = `https://docs.google.com/document/d/${FILE_ID}/edit?usp=sharing`;
const MODIFIED_TIME = "2026-10-20T12:00:00.000Z";
const SHEETS_BASE = "https://docs.google.com/spreadsheets/d";

function available(overrides = {}) {
    return {
        status:       "available",
        product:      "document",
        name:         "Case reading",
        mimeType:     "application/vnd.google-apps.document",
        modifiedTime: MODIFIED_TIME,
        ...overrides,
    };
}

// A fake availability service answering every document with `entry`.
function makeAvailabilityService({ configured = true, entry = available() } = {}) {
    const checks = [];
    return {
        checks,
        isConfigured: () => configured,
        async checkDocuments(parsedList, options) {
            checks.push({ parsedList, options });
            if (entry instanceof Error) {
                throw entry;
            }
            return new Map(parsedList.map((parsed) => [`${parsed.kind}:${parsed.id}`, entry]));
        },
    };
}

async function request(router, { method = "GET", path, body, session = { uid: 7, role: "P" } }) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.session = session;
        next();
    });
    app.use(router);

    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    try {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
            method,
            headers: { "Content-Type": "application/json" },
            body:    body === undefined ? undefined : JSON.stringify(body),
        });
        return { response, body: await response.json() };
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

function preview(router, url, options = {}) {
    return request(router, {
        method: "POST",
        path:   "/cases/documents/preview",
        body:   { url },
        ...options,
    });
}

describe("documentFromInput", () => {
    it("parses pasted Google document links and rejects anything else", () => {
        assert.deepEqual(documentFromInput(DOC_URL), {
            kind: "drive_file", product: "document", id: FILE_ID, resourceKey: null,
        });
        assert.deepEqual(
            documentFromInput(`https://docs.google.com/spreadsheets/d/e/${PUBLISHED_ID}/pubhtml`),
            { kind: "published", product: "spreadsheets", id: PUBLISHED_ID, resourceKey: null }
        );
        assert.equal(documentFromInput(`https://example.com/document/d/${FILE_ID}`), null);
        assert.equal(documentFromInput("https://drive.google.com/drive/folders/abc"), null);
        assert.equal(documentFromInput(FILE_ID), null);
        assert.equal(documentFromInput(null), null);
        assert.equal(documentFromInput(`${DOC_URL}&pad=${"x".repeat(3000)}`), null);
    });
});

describe("previewDocument", () => {
    it("checks live and returns the canonical URL for the refined product", async () => {
        const service = makeAvailabilityService({
            entry: available({
                product:  "spreadsheets",
                mimeType: "application/vnd.google-apps.spreadsheet",
            }),
        });
        const parsed = documentFromInput(
            `https://drive.google.com/file/d/${FILE_ID}/view?resourcekey=0-k`
        );

        const outcome = await previewDocument(parsed, service);

        assert.deepEqual(outcome, {
            status: 200,
            body:   {
                kind:         "drive_file",
                product:      "spreadsheets",
                id:           FILE_ID,
                resourceKey:  "0-k",
                url:          `${SHEETS_BASE}/${FILE_ID}/preview?resourcekey=0-k`,
                name:         "Case reading",
                mimeType:     "application/vnd.google-apps.spreadsheet",
                modifiedTime: MODIFIED_TIME,
            },
        });
        assert.deepEqual(service.checks, [{ parsedList: [parsed], options: { useCache: false } }]);
    });

    it("maps every other status to its error code", async () => {
        const parsed = documentFromInput(DOC_URL);
        for (const status of ["not_public", "not_found", "unavailable", "not_configured"]) {
            const outcome = await previewDocument(
                parsed,
                makeAvailabilityService({ entry: { status } })
            );
            assert.deepEqual(outcome, { code: status });
        }
        const missing = await previewDocument(parsed, makeAvailabilityService({ entry: null }));
        assert.deepEqual(missing, { code: "unavailable" });
    });
});

describe("GET /cases/documents/support", () => {
    it("tells teachers whether document support is configured", async () => {
        for (const configured of [true, false]) {
            const router = createCaseDocumentsRouter({
                availabilityService: makeAvailabilityService({ configured }),
            });
            const { response, body } = await request(router, { path: "/cases/documents/support" });
            assert.equal(response.status, 200);
            assert.deepEqual(body, { enabled: configured });
        }
    });

    it("is for teachers only", async () => {
        const router = createCaseDocumentsRouter({
            availabilityService: makeAvailabilityService(),
        });
        const student = await request(router, {
            path:    "/cases/documents/support",
            session: { uid: 9, role: "A" },
        });
        assert.equal(student.response.status, 403);
        const anonymous = await request(router, { path: "/cases/documents/support", session: {} });
        assert.equal(anonymous.response.status, 401);
    });
});

describe("POST /cases/documents/preview", () => {
    it("returns the document for a pasted link", async () => {
        const service = makeAvailabilityService();
        const router = createCaseDocumentsRouter({ availabilityService: service });

        const { response, body } = await preview(router, DOC_URL);

        assert.equal(response.status, 200);
        assert.deepEqual(body, {
            kind:         "drive_file",
            product:      "document",
            id:           FILE_ID,
            resourceKey:  null,
            url:          `https://docs.google.com/document/d/${FILE_ID}/preview`,
            name:         "Case reading",
            mimeType:     "application/vnd.google-apps.document",
            modifiedTime: MODIFIED_TIME,
        });
        assert.equal(service.checks.length, 1);
        assert.deepEqual(service.checks[0].options, { useCache: false });
    });

    it("returns published documents with null file metadata", async () => {
        const service = makeAvailabilityService({
            entry: available({
                product:      "presentation",
                name:         "Deck",
                mimeType:     null,
                modifiedTime: null,
            }),
        });
        const router = createCaseDocumentsRouter({ availabilityService: service });

        const { response, body } = await preview(
            router,
            `https://docs.google.com/presentation/d/e/${PUBLISHED_ID}/embed?start=false`
        );

        assert.equal(response.status, 200);
        assert.deepEqual(body, {
            kind:         "published",
            product:      "presentation",
            id:           PUBLISHED_ID,
            resourceKey:  null,
            url:          `https://docs.google.com/presentation/d/e/${PUBLISHED_ID}/pub`,
            name:         "Deck",
            mimeType:     null,
            modifiedTime: null,
        });
    });

    it("answers each failure with its status and code", async () => {
        const cases = [
            [{ status: "not_public" }, 422, "not_public"],
            [{ status: "not_found" }, 404, "not_found"],
            [{ status: "unavailable" }, 503, "unavailable"],
            [{ status: "not_configured" }, 503, "not_configured"],
            [new Error("boom"), 503, "unavailable"],
        ];
        for (const [entry, status, code] of cases) {
            const router = createCaseDocumentsRouter({
                availabilityService: makeAvailabilityService({ entry }),
            });
            const { response, body } = await preview(router, DOC_URL);
            assert.equal(response.status, status, code);
            assert.equal(body.status, "err");
            assert.equal(body.code, code);
            assert.equal(typeof body.message, "string");
        }
    });

    it("tells how to make a document public", async () => {
        const router = createCaseDocumentsRouter({
            availabilityService: makeAvailabilityService({ entry: { status: "not_public" } }),
        });
        const { body } = await preview(router, DOC_URL);
        assert.match(body.message, /Anyone with the link/u);
        assert.match(body.message, /publish it to the web/u);
    });

    it("rejects links that are not Google documents without a check", async () => {
        const service = makeAvailabilityService();
        const router = createCaseDocumentsRouter({ availabilityService: service });
        const urls = [
            "https://example.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit",
            "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz",
            "javascript:alert(1)",
            "",
            42,
            undefined,
        ];
        for (const url of urls) {
            const { response, body } = await preview(router, url);
            assert.equal(response.status, 400);
            assert.equal(body.code, "invalid_url");
        }
        assert.equal(service.checks.length, 0);
    });

    it("answers 503 not_configured without a key", async () => {
        const service = makeAvailabilityService({ configured: false });
        const router = createCaseDocumentsRouter({ availabilityService: service });

        const { response, body } = await preview(router, DOC_URL);

        assert.equal(response.status, 503);
        assert.equal(body.code, "not_configured");
        assert.equal(service.checks.length, 0);
    });

    it("throttles each teacher separately", async () => {
        let clock = 0;
        const service = makeAvailabilityService();
        const router = createCaseDocumentsRouter({
            availabilityService: service,
            throttle:            createSlidingWindowThrottle({
                limit:    2,
                windowMs: 60000,
                now:      () => clock,
            }),
        });

        assert.equal((await preview(router, DOC_URL)).response.status, 200);
        clock = 15000;
        assert.equal((await preview(router, DOC_URL)).response.status, 200);
        const throttled = await preview(router, DOC_URL);
        assert.equal(throttled.response.status, 429);
        assert.equal(throttled.body.code, "throttled");
        assert.equal(throttled.response.headers.get("retry-after"), "45");
        assert.equal(service.checks.length, 2);

        const other = await preview(router, DOC_URL, { session: { uid: 8, role: "P" } });
        assert.equal(other.response.status, 200);
    });

    it("allows 30 previews a minute per teacher by default", async () => {
        const router = createCaseDocumentsRouter({
            availabilityService: makeAvailabilityService(),
        });
        for (let index = 0; index < 30; index += 1) {
            assert.equal((await preview(router, DOC_URL)).response.status, 200);
        }
        assert.equal((await preview(router, DOC_URL)).response.status, 429);
    });

    it("is for teachers only", async () => {
        const service = makeAvailabilityService();
        const router = createCaseDocumentsRouter({ availabilityService: service });
        const student = await preview(router, DOC_URL, { session: { uid: 9, role: "A" } });
        assert.equal(student.response.status, 403);
        const anonymous = await preview(router, DOC_URL, { session: {} });
        assert.equal(anonymous.response.status, 401);
        assert.equal(service.checks.length, 0);
    });
});
