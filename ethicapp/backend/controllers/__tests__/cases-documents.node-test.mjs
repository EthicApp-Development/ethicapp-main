// How the case routes wire the documents of #792 (epic #789): reads, writes,
// the lock and the copy paths. PostgreSQL is replaced by a fake pg pool that
// answers by matching the SQL, and the Google availability service by a fake,
// so nothing here needs a database, Redis or the network.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import casesRouter, { caseDocumentServices } from "../cases.js";
import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";

const DOC_ID = "1AbCdEfGhIjKlMn_-Doc";
const PDF_ID = "1AbCdEfGhIjKlMn_-Pdf";
const NEW_ID = "1AbCdEfGhIjKlMn_-New";
const PRIVATE_ID = "1AbCdEfGhIjKlMn_-Prv";
const PUBLISHED_ID = "2PACX-1vAbCdEfGhIjKlMnOpQr";

const DOC_URL = `https://docs.google.com/document/d/${DOC_ID}/preview`;
const PDF_URL = `https://drive.google.com/file/d/${PDF_ID}/preview`;
const NEW_URL = `https://drive.google.com/file/d/${NEW_ID}/view?usp=sharing`;
const PRIVATE_URL = `https://docs.google.com/document/d/${PRIVATE_ID}/edit`;
const PUBLISHED_URL = `https://docs.google.com/presentation/d/e/${PUBLISHED_ID}/pub`;

const DOC_ROW = {
    kind: "drive_file", product: "document", external_id: DOC_ID, resource_key: null,
};
const PDF_ROW = { kind: "drive_file", product: "file", external_id: PDF_ID, resource_key: null };

const CASE_ID = 41;
const COPY_ID = 99;

// --- Fake PostgreSQL -------------------------------------------------------

const state = {
    locked:           false,
    currentDocuments: [],
    documentsJson:    [],
};

function caseRow() {
    return {
        id:               CASE_ID,
        case_uuid:        "00000000-0000-4000-8000-000000000041",
        title:            "A case",
        author_firstname: "Ada",
        author_lastname:  "Lovelace",
        author_email:     "ada@example.com",
        pdf_path:         null,
        creator:          7,
        visibility:       "private",
        language_code:    "es_CL",
        videos:           [],
        documents:        state.documentsJson,
    };
}

function rowsFor(sql) {
    if (/ON a\.design = d\.id\s+WHERE d\.case_id = \$1\s+LIMIT 1/u.test(sql)) {
        return state.locked ? [{ id: 3 }] : [];
    }
    if (/SELECT id, pdf_path, visibility, license_code/u.test(sql)) {
        return [{ id: CASE_ID, pdf_path: null, visibility: "private" }];
    }
    if (/SELECT kind, product, external_id, resource_key\s+FROM ethical_case_doc/u.test(sql)) {
        return state.currentDocuments;
    }
    if (/^\s*UPDATE ethical_cases\b/u.test(sql)) {
        return [caseRow()];
    }
    if (/INSERT INTO ethical_case_author \(/u.test(sql)) {
        return [{ id: 5 }];
    }
    if (/SELECT id, title, author_firstname[\s\S]*FROM ethical_cases\s+WHERE id = \$1/u.test(sql)) {
        return [caseRow()];
    }
    if (/SELECT nextval/u.test(sql)) {
        return [{ id: COPY_ID }];
    }
    if (/FROM ethical_cases c\b/u.test(sql)) {
        return [caseRow()];
    }
    return [];
}

const db = installFakePgPool(rowsFor);

// --- Fake availability service ---------------------------------------------

const originalAvailabilityService = caseDocumentServices.availabilityService;

function useAvailability({ configured = true, entries = {} } = {}) {
    const calls = [];
    caseDocumentServices.availabilityService = {
        isConfigured: () => configured,
        async checkDocuments(parsedList, options) {
            calls.push({ ids: parsedList.map(parsed => parsed.id), options });
            return new Map(parsedList.map(parsed => [
                `${parsed.kind}:${parsed.id}`,
                configured
                    ? entries[parsed.id] ?? { status: "unavailable" }
                    : { status: "not_configured" },
            ]));
        },
    };
    return calls;
}

after(() => {
    db.restore();
    caseDocumentServices.availabilityService = originalAvailabilityService;
});

beforeEach(() => {
    db.reset();
    state.locked = false;
    state.currentDocuments = [];
    state.documentsJson = [];
});

// --- Requests --------------------------------------------------------------

function request(options) {
    return requestRouter(casesRouter, options);
}

function updateCase(fields = {}) {
    return request({
        method: "PATCH",
        path:   `/cases/${CASE_ID}`,
        body:   {
            title:   "A case",
            authors: JSON.stringify([{
                authorFirstname: "Ada", authorLastname: "Lovelace", authorEmail: "ada@example.com",
            }]),
            ...fields,
        },
    });
}

function documentWrites() {
    return db.queries.filter(query => {
        return /^\s*(DELETE FROM|INSERT INTO) ethical_case_documents/u.test(query.sql);
    });
}

function isDocumentCopy(sql) {
    return /^INSERT INTO ethical_case_documents[\s\S]*FROM ethical_case_documents ecd/u
        .test(sql);
}

function uncachedChecks(calls) {
    return calls.filter(call => call.options?.useCache === false);
}

function available(name, extra = {}) {
    return {
        status:       "available",
        product:      "file",
        name,
        mimeType:     "application/pdf",
        modifiedTime: null,
        ...extra,
    };
}

function stored(kind, product, id, position) {
    return { kind, product, id, resourceKey: null, position };
}

// --- Tests -----------------------------------------------------------------

describe("GET /cases/:id", () => {
    it("returns ordered documents with availability resolved through the cache", async () => {
        state.documentsJson = [
            stored("published", "presentation", PUBLISHED_ID, 3),
            stored("drive_file", "document", DOC_ID, 1),
            stored("drive_file", "file", PDF_ID, 2),
        ];
        const calls = useAvailability({
            entries: {
                [DOC_ID]: available("Notes", {
                    product:  "document",
                    mimeType: "application/vnd.google-apps.document",
                }),
                [PDF_ID]:       { status: "not_public" },
                [PUBLISHED_ID]: { status: "unavailable" },
            },
        });

        const { status, body } = await request({ path: `/cases/${CASE_ID}` });

        assert.equal(status, 200);
        assert.deepEqual(calls, [
            { ids: [DOC_ID, PDF_ID, PUBLISHED_ID], options: { useCache: true } },
        ]);
        assert.deepEqual(body.result.documents, [
            {
                ...stored("drive_file", "document", DOC_ID, 1),
                url:          DOC_URL,
                availability: {
                    status:       "available",
                    name:         "Notes",
                    mimeType:     "application/vnd.google-apps.document",
                    modifiedTime: null,
                },
            },
            {
                ...stored("drive_file", "file", PDF_ID, 2),
                url:          PDF_URL,
                availability: {
                    status: "not_public", name: null, mimeType: null, modifiedTime: null,
                },
            },
            {
                ...stored("published", "presentation", PUBLISHED_ID, 3),
                url:          PUBLISHED_URL,
                availability: null,
            },
        ]);
    });

    it("returns null availability when Google support is not configured", async () => {
        state.documentsJson = [stored("drive_file", "document", DOC_ID, 1)];
        const calls = useAvailability({ configured: false });

        const { body } = await request({
            path:    `/cases/${CASE_ID}`,
            session: { uid: 9, role: "A" },
        });

        assert.equal(body.result.documents[0].url, DOC_URL);
        assert.equal(body.result.documents[0].availability, null);
        assert.deepEqual(calls, []);
    });

    it("reads the case through the same access rules as its videos", async () => {
        useAvailability();
        await request({ path: `/cases/${CASE_ID}`, session: { uid: 9, role: "A" } });

        const read = db.queries.find(query => /FROM ethical_cases c\b/u.test(query.sql));
        assert.match(read.sql, /c\.creator = \$2/u);
        assert.match(read.sql, /sesusers su/u);
        assert.match(read.sql, /FROM ethical_case_documents ecd/u);
        assert.match(read.sql, /FROM ethical_case_videos ecv/u);
        assert.deepEqual(read.params, [CASE_ID, 9]);
    });
});

describe("GET /cases and /cases/search", () => {
    it("lists documents without availability and asks Google nothing", async () => {
        state.documentsJson = [stored("drive_file", "document", DOC_ID, 1)];
        const calls = useAvailability();

        const { status, body } = await request({ path: "/cases" });

        assert.equal(status, 200);
        assert.deepEqual(body.result[0].documents, [
            { ...stored("drive_file", "document", DOC_ID, 1), url: DOC_URL },
        ]);
        assert.deepEqual(calls, []);
    });

    it("search results carry the same summaries", async () => {
        state.documentsJson = [stored("drive_file", "file", PDF_ID, 1)];
        const calls = useAvailability();

        const { body } = await request({ path: "/cases/search?q=case" });

        assert.deepEqual(body.result[0].documents, [
            { ...stored("drive_file", "file", PDF_ID, 1), url: PDF_URL },
        ]);
        assert.deepEqual(calls, []);
    });
});

describe("PATCH /cases/:id with documents", () => {
    it("leaves the documents unchanged when the field is absent", async () => {
        state.currentDocuments = [DOC_ROW];
        const calls = useAvailability();

        const { status, body } = await updateCase();

        assert.equal(status, 200);
        assert.deepEqual(documentWrites(), []);
        assert.deepEqual(uncachedChecks(calls), []);
        assert.deepEqual(body.result.documents.map(document => document.id), [DOC_ID]);
    });

    it("checks a new document uncached, keeps the old one and writes the order", async () => {
        state.currentDocuments = [DOC_ROW];
        const calls = useAvailability({
            entries: {
                [NEW_ID]: available("Slides", {
                    product:  "presentation",
                    mimeType: "application/vnd.google-apps.presentation",
                }),
            },
        });

        const documents = JSON.stringify([NEW_URL, DOC_URL]);
        const { status, body } = await updateCase({ documents });

        assert.equal(status, 200);
        assert.deepEqual(uncachedChecks(calls), [{ ids: [NEW_ID], options: { useCache: false } }]);
        const [deleteQuery, insertQuery] = documentWrites();
        assert.deepEqual(deleteQuery.params, [CASE_ID]);
        assert.deepEqual(insertQuery.params, [
            CASE_ID,
            ["drive_file", "drive_file"],
            ["presentation", "document"],
            [NEW_ID, DOC_ID],
            [null, null],
        ]);
        const order = body.result.documents.map(document => [document.product, document.position]);
        assert.deepEqual(order, [
            ["presentation", 1],
            ["document", 2],
        ]);
    });

    it("reorders and removes without asking Google, even when it is not configured", async () => {
        state.currentDocuments = [DOC_ROW, PDF_ROW];
        const calls = useAvailability({ configured: false });

        const reordered = await updateCase({ documents: JSON.stringify([PDF_URL, DOC_URL]) });
        assert.equal(reordered.status, 200);
        assert.deepEqual(documentWrites()[1].params[3], [PDF_ID, DOC_ID]);

        db.reset();
        const cleared = await updateCase({ documents: "[]" });
        assert.equal(cleared.status, 200);
        assert.equal(documentWrites().length, 1);
        assert.match(documentWrites()[0].sql, /^\s*DELETE/u);
        assert.deepEqual(cleared.body.result.documents, []);

        assert.deepEqual(calls, []);
    });

    it("rejects documents that are not public or not found, before writing anything", async () => {
        useAvailability({
            entries: { [PRIVATE_ID]: { status: "not_public" }, [NEW_ID]: { status: "not_found" } },
        });

        const documents = JSON.stringify([PRIVATE_URL, NEW_URL]);
        const { status, body } = await updateCase({ documents });

        assert.equal(status, 400);
        assert.deepEqual(body, {
            status:  "err",
            message: "Some documents cannot be added to the case.",
            code:    "CASE_DOCUMENTS_REJECTED",
            fields:  { [PRIVATE_URL]: "not_public", [NEW_URL]: "not_found" },
        });
        const updates = db.queries.filter(query => /^\s*UPDATE ethical_cases\b/u.test(query.sql));
        assert.deepEqual(updates, []);
        assert.deepEqual(documentWrites(), []);
    });

    it("answers 400 not configured when documents are added without a Google key", async () => {
        useAvailability({ configured: false });

        const { status, body } = await updateCase({ documents: JSON.stringify([NEW_URL]) });

        assert.equal(status, 400);
        assert.equal(body.code, "CASE_DOCUMENTS_NOT_CONFIGURED");
        assert.deepEqual(body.fields, { [NEW_URL]: "not_configured" });
        assert.deepEqual(documentWrites(), []);
    });

    it("answers 503 when Google cannot be reached for a new document", async () => {
        useAvailability({ entries: { [NEW_ID]: { status: "unavailable" } } });

        const { status, body } = await updateCase({ documents: JSON.stringify([NEW_URL]) });

        assert.equal(status, 503);
        assert.equal(body.code, "CASE_DOCUMENTS_UNAVAILABLE");
        assert.deepEqual(body.fields, { [NEW_URL]: "unavailable" });
        assert.deepEqual(documentWrites(), []);
    });

    it("answers 400 invalid for malformed input, before reading the case", async () => {
        const calls = useAvailability();

        const documents = JSON.stringify(["https://example.com/x"]);
        const { status, body } = await updateCase({ documents });

        assert.equal(status, 400);
        assert.equal(body.code, "CASE_DOCUMENTS_INVALID");
        assert.deepEqual(body.fields, { "https://example.com/x": "invalid_url" });
        assert.deepEqual(db.queries, []);
        assert.deepEqual(calls, []);
    });

    it("refuses a locked case with 409 before asking Google", async () => {
        state.locked = true;
        const calls = useAvailability({ entries: { [NEW_ID]: available("New") } });

        const { status, body } = await updateCase({ documents: JSON.stringify([NEW_URL]) });

        assert.equal(status, 409);
        assert.equal(body.code, "CASE_USED_BY_LAUNCHED_ACTIVITY");
        assert.deepEqual(calls, []);
        assert.deepEqual(documentWrites(), []);
    });
});

describe("case copies", () => {
    for (const action of ["import", "duplicate"]) {
        it(`${action} copies the documents inside its transaction`, async () => {
            useAvailability();

            const { status } = await request({
                method: "POST",
                path:   `/cases/${CASE_ID}/${action}`,
            });

            assert.equal(status, 201);
            const sqls = db.queries.map(query => query.sql.trim());
            const copyIndex = sqls.findIndex(isDocumentCopy);
            assert.notEqual(copyIndex, -1, "the documents are copied");
            assert.deepEqual(db.queries[copyIndex].params, [CASE_ID, COPY_ID]);
            assert.ok(copyIndex < sqls.indexOf("COMMIT"));
        });
    }
});
