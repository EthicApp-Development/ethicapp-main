import assert from "node:assert/strict";
import test from "node:test";
import {
    CASE_DOCUMENT_ERROR_CODES,
    MAX_CASE_DOCUMENTS,
    caseDocumentSummariesFromDocuments,
    caseDocumentsJsonSql,
    checkNewCaseDocuments,
    copyCaseDocuments,
    listCaseDocuments,
    normalizeCaseDocumentSummaries,
    parseCaseDocuments,
    planCaseDocumentChanges,
    prepareCaseDocumentSave,
    replaceCaseDocuments,
    resolveCaseDocuments,
} from "../case-documents.js";

const DOC_ID = "1AbCdEfGhIjKlMn_-Doc";
const SHEET_ID = "1AbCdEfGhIjKlMn_-Sht";
const PDF_ID = "1AbCdEfGhIjKlMn_-Pdf";
const SLIDES_IN_DRIVE_ID = "1AbCdEfGhIjKlMn_-Sld";
const PRIVATE_ID = "1AbCdEfGhIjKlMn_-Prv";
const DELETED_ID = "1AbCdEfGhIjKlMn_-Del";
const UNREACHABLE_ID = "1AbCdEfGhIjKlMn_-Unr";
const PUBLISHED_ID = "2PACX-1vAbCdEfGhIjKlMnOpQr";

const DOC_URL = `https://docs.google.com/document/d/${DOC_ID}/edit?usp=sharing`;
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`;
const PDF_URL = `https://drive.google.com/file/d/${PDF_ID}/view?usp=sharing`;
const SLIDES_IN_DRIVE_URL = `https://drive.google.com/open?id=${SLIDES_IN_DRIVE_ID}`;
const PRIVATE_URL = `https://docs.google.com/document/d/${PRIVATE_ID}/edit`;
const DELETED_URL = `https://drive.google.com/file/d/${DELETED_ID}/view`;
const UNREACHABLE_URL = `https://docs.google.com/document/d/${UNREACHABLE_ID}/edit`;
const PUBLISHED_URL = `https://docs.google.com/spreadsheets/d/e/${PUBLISHED_ID}/pubhtml`;

const DOC = { kind: "drive_file", product: "document", id: DOC_ID, resourceKey: null };
const SHEET = { kind: "drive_file", product: "spreadsheets", id: SHEET_ID, resourceKey: null };
const PDF = { kind: "drive_file", product: "file", id: PDF_ID, resourceKey: null };
const PUBLISHED = {
    kind: "published", product: "spreadsheets", id: PUBLISHED_ID, resourceKey: null,
};

const MODIFIED = "2026-10-20T12:00:00.000Z";
const DOCS_MIME = "application/vnd.google-apps.document";
const SHEETS_MIME = "application/vnd.google-apps.spreadsheet";

function available(product, name, mimeType = null, modifiedTime = MODIFIED) {
    return { status: "available", product, name, mimeType, modifiedTime };
}

const ENTRIES = new Map([
    [`drive_file:${DOC_ID}`, available("document", "Case notes", DOCS_MIME)],
    [`drive_file:${SHEET_ID}`, available("spreadsheets", "Data", SHEETS_MIME)],
    [`drive_file:${PDF_ID}`, available("file", "Reading.pdf", "application/pdf")],
    [
        `drive_file:${SLIDES_IN_DRIVE_ID}`,
        available("presentation", "Slides", "application/vnd.google-apps.presentation"),
    ],
    [`drive_file:${PRIVATE_ID}`, { status: "not_public" }],
    [`drive_file:${DELETED_ID}`, { status: "not_found" }],
    [`drive_file:${UNREACHABLE_ID}`, { status: "unavailable" }],
    [`published:${PUBLISHED_ID}`, available("spreadsheets", "Published data", null, null)],
]);

// A fake of the #791 availability service, as the epic's "Shared interfaces" define it.
function fakeAvailabilityService({ configured = true, entries = ENTRIES, error = null } = {}) {
    const calls = [];
    return {
        calls,
        isConfigured: () => configured,
        async checkDocuments(parsedList, options) {
            calls.push({ documents: parsedList.map(parsed => ({ ...parsed })), options });
            if (error) {
                throw error;
            }
            return new Map(parsedList.map(parsed => {
                const key = `${parsed.kind}:${parsed.id}`;
                return [key, configured ? entries.get(key) : { status: "not_configured" }];
            }).filter(([, entry]) => entry));
        },
    };
}

function services(options) {
    return { availabilityService: fakeAvailabilityService(options) };
}

function checkedKeys(deps) {
    return deps.availabilityService.calls.map(call => call.documents.map(parsed => parsed.id));
}

function quietly(fn) {
    return async () => {
        const original = console.error;
        console.error = () => {};
        try {
            await fn();
        } finally {
            console.error = original;
        }
    };
}

function fakeDb(rows = []) {
    const queries = [];
    return {
        queries,
        async query(sql, params) {
            queries.push({ sql, params });
            return { rows };
        },
    };
}

// parseCaseDocuments

test("parseCaseDocuments: an absent field leaves the documents unchanged", () => {
    assert.deepEqual(parseCaseDocuments(undefined), { ok: true, provided: false });
    assert.deepEqual(parseCaseDocuments(null), { ok: true, provided: false });
});

test("parseCaseDocuments: a JSON array keeps its order, and an empty one removes all", () => {
    assert.deepEqual(parseCaseDocuments(JSON.stringify([SHEET_URL, DOC_URL, PUBLISHED_URL])), {
        ok:        true,
        provided:  true,
        documents: [
            { ...SHEET, url: SHEET_URL },
            { ...DOC, url: DOC_URL },
            { ...PUBLISHED, url: PUBLISHED_URL },
        ],
    });
    assert.deepEqual(parseCaseDocuments("[]"), { ok: true, provided: true, documents: [] });
    assert.deepEqual(parseCaseDocuments([PDF_URL]).documents, [{ ...PDF, url: PDF_URL }]);
});

test("parseCaseDocuments: keeps a link's resource key", () => {
    const url = `https://drive.google.com/file/d/${PDF_ID}/view?resourcekey=0-AbC_d`;
    assert.deepEqual(parseCaseDocuments([url]).documents, [
        { ...PDF, resourceKey: "0-AbC_d", url },
    ]);
});

test("parseCaseDocuments: rejects unparseable URLs with per-URL field errors", () => {
    const folder = "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz";
    const other = "https://example.com/doc";
    const result = parseCaseDocuments(JSON.stringify([DOC_URL, folder, other, 7]));

    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(result.body.status, "err");
    assert.equal(result.body.code, CASE_DOCUMENT_ERROR_CODES.invalid);
    assert.deepEqual(result.body.fields, {
        [folder]:                  "invalid_url",
        "https://example.com/doc": "invalid_url",
        7:                         "invalid_url",
    });
});

test("parseCaseDocuments: rejects the same document twice, by kind and id", () => {
    const sameDocAgain = `https://docs.google.com/document/u/1/d/${DOC_ID}/preview`;
    const result = parseCaseDocuments([DOC_URL, SHEET_URL, sameDocAgain]);

    assert.equal(result.ok, false);
    assert.equal(result.body.code, CASE_DOCUMENT_ERROR_CODES.invalid);
    assert.deepEqual(result.body.fields, { [sameDocAgain]: "duplicate" });
});

test("parseCaseDocuments: rejects a field that is not a JSON array", () => {
    for (const value of ["not json", "{\"url\":1}", JSON.stringify(DOC_URL), ""]) {
        const result = parseCaseDocuments(value);
        assert.equal(result.ok, false, value);
        assert.deepEqual(result.body.fields, { documents: "invalid" });
    }
});

test("parseCaseDocuments: rejects more than MAX_CASE_DOCUMENTS documents", () => {
    const urls = Array.from({ length: MAX_CASE_DOCUMENTS + 1 }, (_, index) => {
        const id = `${DOC_ID.slice(0, -3)}${String(index).padStart(3, "0")}`;
        return `https://docs.google.com/document/d/${id}/edit`;
    });

    assert.equal(MAX_CASE_DOCUMENTS, 20);
    assert.equal(parseCaseDocuments(urls.slice(0, MAX_CASE_DOCUMENTS)).ok, true);
    assert.deepEqual(parseCaseDocuments(urls).body.fields, { documents: "too_many" });
});

// planCaseDocumentChanges

test("planCaseDocumentChanges: adding, keeping, reordering and removing", () => {
    assert.deepEqual(planCaseDocumentChanges([DOC], [DOC, SHEET]), {
        newDocuments: [SHEET], removedDocuments: [], changed: true,
    });
    assert.deepEqual(planCaseDocumentChanges([DOC, SHEET], [DOC, SHEET]), {
        newDocuments: [], removedDocuments: [], changed: false,
    });
    assert.deepEqual(planCaseDocumentChanges([DOC, SHEET], [SHEET, DOC]), {
        newDocuments: [], removedDocuments: [], changed: true,
    });
    assert.deepEqual(planCaseDocumentChanges([DOC, SHEET], [SHEET]), {
        newDocuments: [], removedDocuments: [DOC], changed: true,
    });
    assert.deepEqual(planCaseDocumentChanges([DOC], []), {
        newDocuments: [], removedDocuments: [DOC], changed: true,
    });
});

test("planCaseDocumentChanges: a kept document matches by kind and id, not product", () => {
    const refined = { ...PDF, product: "presentation" };
    assert.deepEqual(planCaseDocumentChanges([refined], [PDF]), {
        newDocuments: [], removedDocuments: [], changed: false,
    });
});

// prepareCaseDocumentSave and checkNewCaseDocuments

test("prepareCaseDocumentSave: an absent field writes nothing, asks Google nothing", async () => {
    const deps = services();
    const result = await prepareCaseDocumentSave({ ok: true, provided: false }, [DOC], deps);

    assert.deepEqual(result, { ok: true, documents: null });
    assert.deepEqual(deps.availabilityService.calls, []);
});

test("prepareCaseDocumentSave: checks only new documents, uncached", async () => {
    const deps = services();
    const parsed = parseCaseDocuments([PDF_URL, DOC_URL, PUBLISHED_URL]);
    const result = await prepareCaseDocumentSave(parsed, [DOC, SHEET], deps);

    assert.deepEqual(result, { ok: true, documents: [PDF, DOC, PUBLISHED] });
    assert.deepEqual(checkedKeys(deps), [[PDF_ID, PUBLISHED_ID]]);
    assert.deepEqual(deps.availabilityService.calls[0].options, { useCache: false });
    assert.deepEqual(deps.availabilityService.calls[0].documents, [PDF, PUBLISHED]);
});

test("prepareCaseDocumentSave: a Drive link stores the product the check found", async () => {
    const parsed = parseCaseDocuments([SLIDES_IN_DRIVE_URL]);
    const result = await prepareCaseDocumentSave(parsed, [], services());

    assert.deepEqual(result.documents, [{
        kind: "drive_file", product: "presentation", id: SLIDES_IN_DRIVE_ID, resourceKey: null,
    }]);
});

test("prepareCaseDocumentSave: a published link keeps the product of its URL", async () => {
    const entries = new Map(ENTRIES);
    entries.set(`published:${PUBLISHED_ID}`, available("file", "Odd", null, null));

    const result = await prepareCaseDocumentSave(
        parseCaseDocuments([PUBLISHED_URL]),
        [],
        services({ entries })
    );
    assert.deepEqual(result.documents, [PUBLISHED]);
});

test("prepareCaseDocumentSave: reordering or removing asks Google nothing", async () => {
    const deps = services({ configured: false });

    assert.deepEqual(
        await prepareCaseDocumentSave(parseCaseDocuments([SHEET_URL, DOC_URL]), [DOC, SHEET], deps),
        { ok: true, documents: [SHEET, DOC] }
    );
    assert.deepEqual(
        await prepareCaseDocumentSave(parseCaseDocuments([]), [DOC, SHEET], deps),
        { ok: true, documents: [] }
    );
    assert.deepEqual(deps.availabilityService.calls, []);
});

test("prepareCaseDocumentSave: an unchanged list is not written again", async () => {
    const deps = services();
    const result = await prepareCaseDocumentSave(parseCaseDocuments([DOC_URL]), [DOC], deps);

    assert.deepEqual(result, { ok: true, documents: null });
    assert.deepEqual(deps.availabilityService.calls, []);
});

test("prepareCaseDocumentSave: a kept document keeps its stored parts", async () => {
    const stored = { ...PDF, product: "presentation", resourceKey: "0-Key" };
    const result = await prepareCaseDocumentSave(
        parseCaseDocuments([DOC_URL, PDF_URL]),
        [stored],
        services()
    );

    assert.deepEqual(result.documents, [DOC, stored]);
});

test("prepareCaseDocumentSave: a case keeps a document whose sharing changed", async () => {
    const stored = { kind: "drive_file", product: "document", id: PRIVATE_ID, resourceKey: null };
    const result = await prepareCaseDocumentSave(
        parseCaseDocuments([PRIVATE_URL, DOC_URL]),
        [stored],
        services()
    );
    assert.deepEqual(result, { ok: true, documents: [stored, DOC] });
});

test("checkNewCaseDocuments: rejects not public and not found documents with 400", async () => {
    const parsed = parseCaseDocuments([DOC_URL, PRIVATE_URL, DELETED_URL]).documents;
    const result = await checkNewCaseDocuments(parsed, services());

    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(result.body.status, "err");
    assert.equal(result.body.code, CASE_DOCUMENT_ERROR_CODES.rejected);
    assert.deepEqual(result.body.fields, {
        [PRIVATE_URL]: "not_public",
        [DELETED_URL]: "not_found",
    });
});

test("checkNewCaseDocuments: answers 503 when Google cannot check a new document", async () => {
    const parsed = parseCaseDocuments([DOC_URL, UNREACHABLE_URL]).documents;
    const result = await checkNewCaseDocuments(parsed, services());

    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
    assert.equal(result.body.code, CASE_DOCUMENT_ERROR_CODES.unavailable);
    assert.deepEqual(result.body.fields, { [UNREACHABLE_URL]: "unavailable" });
});

test("checkNewCaseDocuments: a rejected document wins over an unchecked one", async () => {
    const parsed = parseCaseDocuments([UNREACHABLE_URL, DELETED_URL]).documents;
    const result = await checkNewCaseDocuments(parsed, services());

    assert.equal(result.status, 400);
    assert.deepEqual(result.body.fields, { [DELETED_URL]: "not_found" });
});

test("checkNewCaseDocuments: a missing entry or a throwing service counts as unavailable",
    quietly(async () => {
        const unknown = `https://docs.google.com/document/d/${"Z".repeat(30)}/edit`;
        const missing = await checkNewCaseDocuments(
            parseCaseDocuments([unknown]).documents,
            services()
        );
        assert.equal(missing.status, 503);
        assert.deepEqual(missing.body.fields, { [unknown]: "unavailable" });

        const throwing = await checkNewCaseDocuments(
            parseCaseDocuments([DOC_URL]).documents,
            services({ error: new Error("boom") })
        );
        assert.equal(throwing.status, 503);
        assert.deepEqual(throwing.body.fields, { [DOC_URL]: "unavailable" });
    })
);

test("checkNewCaseDocuments: without a Google key, 400 not configured", async () => {
    const deps = services({ configured: false });
    const result = await checkNewCaseDocuments(
        parseCaseDocuments([DOC_URL, PUBLISHED_URL]).documents,
        deps
    );

    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, CASE_DOCUMENT_ERROR_CODES.notConfigured);
    assert.deepEqual(result.body.fields, {
        [DOC_URL]:       "not_configured",
        [PUBLISHED_URL]: "not_configured",
    });
    assert.deepEqual(deps.availabilityService.calls, []);
});

test("checkNewCaseDocuments: a not_configured entry also answers 400", async () => {
    const deps = services();
    deps.availabilityService.checkDocuments = async parsedList => {
        return new Map(parsedList.map(parsed => {
            return [`${parsed.kind}:${parsed.id}`, { status: "not_configured" }];
        }));
    };

    const result = await checkNewCaseDocuments(parseCaseDocuments([DOC_URL]).documents, deps);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, CASE_DOCUMENT_ERROR_CODES.notConfigured);
});

test("checkNewCaseDocuments: nothing new asks Google nothing", async () => {
    const deps = services();
    assert.deepEqual(await checkNewCaseDocuments([], deps), { ok: true, documents: [] });
    assert.deepEqual(deps.availabilityService.calls, []);
});

// Reading

test("normalizeCaseDocumentSummaries: listings carry parts, position and URL, in order", () => {
    const summaries = normalizeCaseDocumentSummaries([
        { ...PUBLISHED, position: 3 },
        { ...PDF, resourceKey: "0-Key", position: 2 },
        { ...DOC, position: 1 },
        { kind: "drive_file", product: "document", id: "bad", resourceKey: null, position: 4 },
        null,
    ]);

    assert.deepEqual(summaries, [
        { ...DOC, position: 1, url: `https://docs.google.com/document/d/${DOC_ID}/preview` },
        {
            ...PDF,
            resourceKey: "0-Key",
            position:    2,
            url:         `https://drive.google.com/file/d/${PDF_ID}/preview?resourcekey=0-Key`,
        },
        {
            ...PUBLISHED,
            position: 3,
            url:      `https://docs.google.com/spreadsheets/d/e/${PUBLISHED_ID}/pubhtml`,
        },
    ]);
    assert.ok(summaries.every(summary => !("availability" in summary)));
    assert.deepEqual(normalizeCaseDocumentSummaries(null), []);
});

test("caseDocumentSummariesFromDocuments: numbers documents from 1, in order", () => {
    assert.deepEqual(
        caseDocumentSummariesFromDocuments([SHEET, DOC])
            .map(summary => [summary.id, summary.position]),
        [[SHEET_ID, 1], [DOC_ID, 2]]
    );
});

test("caseDocumentsJsonSql: reads the documents of the given case alias, ordered", () => {
    const sql = caseDocumentsJsonSql("c");

    assert.match(sql, /FROM ethical_case_documents ecd/u);
    assert.match(sql, /WHERE ecd\.case_id = c\.id/u);
    assert.match(sql, /'id', ecd\.external_id/u);
    assert.match(sql, /'resourceKey', ecd\.resource_key/u);
    assert.match(sql, /ORDER BY ecd\.position/u);
    assert.match(sql, /'\[\]'::json/u);
});

test("resolveCaseDocuments: reads availability through the cache", async () => {
    const deps = services();
    const stored = [
        DOC,
        { kind: "drive_file", product: "document", id: PRIVATE_ID, resourceKey: null },
        { kind: "drive_file", product: "file", id: DELETED_ID, resourceKey: null },
        { kind: "drive_file", product: "document", id: UNREACHABLE_ID, resourceKey: null },
        PUBLISHED,
    ];
    const documents = await resolveCaseDocuments(caseDocumentSummariesFromDocuments(stored), deps);

    assert.deepEqual(deps.availabilityService.calls, [
        { documents: stored, options: { useCache: true } },
    ]);
    assert.deepEqual(documents.map(document => document.availability), [
        {
            status:       "available",
            name:         "Case notes",
            mimeType:     "application/vnd.google-apps.document",
            modifiedTime: MODIFIED,
        },
        { status: "not_public", name: null, mimeType: null, modifiedTime: null },
        { status: "not_found", name: null, mimeType: null, modifiedTime: null },
        null,
        { status: "available", name: "Published data", mimeType: null, modifiedTime: null },
    ]);
    assert.deepEqual(documents[0], {
        ...DOC,
        position:     1,
        url:          `https://docs.google.com/document/d/${DOC_ID}/preview`,
        availability: documents[0].availability,
    });
    assert.deepEqual(documents.map(document => document.position), [1, 2, 3, 4, 5]);
});

test("resolveCaseDocuments: without a Google key no document gets availability", async () => {
    const deps = services({ configured: false });
    const summaries = caseDocumentSummariesFromDocuments([DOC, PUBLISHED]);
    const documents = await resolveCaseDocuments(summaries, deps);

    assert.deepEqual(documents.map(document => document.availability), [null, null]);
    assert.deepEqual(documents.map(document => document.id), [DOC_ID, PUBLISHED_ID]);
    assert.deepEqual(deps.availabilityService.calls, []);
});

test("resolveCaseDocuments: a not_configured entry leaves the availability null", async () => {
    const deps = services();
    deps.availabilityService.checkDocuments = async parsedList => {
        return new Map(parsedList.map(parsed => {
            return [`${parsed.kind}:${parsed.id}`, { status: "not_configured" }];
        }));
    };
    const documents = await resolveCaseDocuments(caseDocumentSummariesFromDocuments([DOC]), deps);
    assert.equal(documents[0].availability, null);
});

test("resolveCaseDocuments: a throwing service leaves the availability null", quietly(async () => {
    const documents = await resolveCaseDocuments(
        caseDocumentSummariesFromDocuments([DOC]),
        services({ error: new Error("boom") })
    );
    assert.equal(documents[0].availability, null);
    assert.equal(documents[0].url, `https://docs.google.com/document/d/${DOC_ID}/preview`);
}));

test("resolveCaseDocuments: a case without documents asks Google nothing", async () => {
    const deps = services();
    assert.deepEqual(await resolveCaseDocuments([], deps), []);
    assert.deepEqual(deps.availabilityService.calls, []);
});

// Storage and copies

test("listCaseDocuments: reads a case's documents in position order", async () => {
    const db = fakeDb([
        { kind: "drive_file", product: "file", external_id: PDF_ID, resource_key: "0-Key" },
        {
            kind:         "published",
            product:      "spreadsheets",
            external_id:  PUBLISHED_ID,
            resource_key: null,
        },
    ]);

    assert.deepEqual(await listCaseDocuments(db, 12), [
        { ...PDF, resourceKey: "0-Key" },
        PUBLISHED,
    ]);
    assert.match(db.queries[0].sql, /FROM ethical_case_documents/u);
    assert.match(db.queries[0].sql, /ORDER BY position/u);
    assert.deepEqual(db.queries[0].params, [12]);
});

test("replaceCaseDocuments: deletes the old list and inserts the new one in order", async () => {
    const db = fakeDb();
    await replaceCaseDocuments(db, 12, [PUBLISHED, { ...PDF, resourceKey: "0-Key" }, DOC]);

    assert.equal(db.queries.length, 2);
    assert.match(db.queries[0].sql, /DELETE FROM ethical_case_documents WHERE case_id = \$1/u);
    assert.deepEqual(db.queries[0].params, [12]);
    assert.match(db.queries[1].sql, /WITH ORDINALITY/u);
    assert.deepEqual(db.queries[1].params, [
        12,
        ["published", "drive_file", "drive_file"],
        ["spreadsheets", "file", "document"],
        [PUBLISHED_ID, PDF_ID, DOC_ID],
        [null, "0-Key", null],
    ]);
});

test("replaceCaseDocuments: an empty list only deletes", async () => {
    const db = fakeDb();
    await replaceCaseDocuments(db, 12, []);

    assert.equal(db.queries.length, 1);
    assert.match(db.queries[0].sql, /^DELETE/u);
});

test("copyCaseDocuments: copies the source case's documents with their positions", async () => {
    const db = fakeDb();
    await copyCaseDocuments(db, 12, 34);

    assert.equal(db.queries.length, 1);
    assert.match(
        db.queries[0].sql,
        /SELECT \$2, ecd\.position, ecd\.kind, ecd\.product, ecd\.external_id, ecd\.resource_key/u
    );
    assert.match(db.queries[0].sql, /WHERE ecd\.case_id = \$1/u);
    assert.deepEqual(db.queries[0].params, [12, 34]);
});

test("seed round trip: canonical URLs parse back to the stored parts", () => {
    const stored = [DOC, { ...PDF, resourceKey: "0-Key" }, PUBLISHED, {
        kind: "drive_file", product: "presentation", id: SLIDES_IN_DRIVE_ID, resourceKey: null,
    }];
    const urls = caseDocumentSummariesFromDocuments(stored).map(summary => summary.url);
    const parsed = parseCaseDocuments(urls);

    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.documents.map(document => {
        const { url, ...parts } = document;
        assert.equal(typeof url, "string");
        return parts;
    }), stored);
});
