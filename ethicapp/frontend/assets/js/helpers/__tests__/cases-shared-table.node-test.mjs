// The "Shared by others" tab of the Cases page (#1016, epic #1008): each
// row's columns and its import state, and the search.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildSharedCaseRow,
    buildSharedCaseRows,
    rightsStatusKey,
    sharedCaseAuthor,
    sharedCaseLicense,
    sharedCaseMatchesSearch,
} from "../cases-shared-table.js";

const LANGUAGES = new Map([["es_CL", "Español"], ["en_US", "English"]]);

function shared(id, fields = {}) {
    return {
        id,
        title:        `Shared ${id}`,
        visibility:   "public",
        languageCode: "es_CL",
        licenseCode:  "CC-BY-SA-4.0",
        rightsStatus: "own_work",
        authors:      [{ authorFirstname: "Andrea", authorLastname: "Rojas" }],
        ...fields,
    };
}

describe("shared cases table, rows", () => {
    it("shows the pages and language, the author, and the license with the rights status", () => {
        const row = buildSharedCaseRow(shared(5, {
            documentProcessing: { status: "completed", pageCount: 4 },
            videos:             [{ id: 1 }],
            documents:          [{ id: 2 }],
        }), new Map(), LANGUAGES);
        assert.equal(row.id, 5);
        assert.equal(row.title, "Shared 5");
        assert.deepEqual(row.meta, [
            { key: "cases_meta_pages_other", params: { count: 4 } },
            { text: "Español" },
        ]);
        assert.equal(row.author, "Andrea Rojas");
        assert.deepEqual(row.license, { text: "CC BY-SA 4.0" });
        assert.equal(row.rightsKey, "rights_status_own_work");
        assert.equal(row.importState, "importable");
        assert.equal(row.copyId, null);
    });

    it("shows only the language while the PDF has no pages", () => {
        const row = buildSharedCaseRow(shared(5, {
            languageCode:       "en_US",
            documentProcessing: { status: "processing" },
        }), new Map(), LANGUAGES);
        assert.deepEqual(row.meta, [{ text: "English" }]);
    });

    it("marks a case the teacher already imported with its copy", () => {
        const ownCases = [
            { id: 20, importedFromCaseId: 5 },
            { id: 21, importedFromCaseId: 7, archived: true },
            // A duplicate of the teacher's copy points at the copy.
            { id: 22, importedFromCaseId: 20 },
        ];
        const rows = buildSharedCaseRows([shared(5), shared(6), shared(7)], ownCases);
        assert.deepEqual(rows.map(row => [row.id, row.importState, row.copyId]), [
            [5, "imported", 20],
            [6, "importable", null],
            [7, "imported", 21],
        ]);
    });

    it("links every row to a new design with the case, imported or not (#1019)", () => {
        const copies = [{ id: 20, importedFromCaseId: 5 }];
        const rows = buildSharedCaseRows([shared(5), shared(6)], copies);
        assert.deepEqual(rows.map(row => [row.id, row.importState, row.newDesignHref]), [
            [5, "imported", "#!/designs/new?caseId=5"],
            [6, "importable", "#!/designs/new?caseId=6"],
        ]);
    });

    it("keeps the order of the shared cases, and lists nothing without them", () => {
        const rows = buildSharedCaseRows([shared(9), shared(3)], []);
        assert.deepEqual(rows.map(row => row.id), [9, 3]);
        assert.deepEqual(buildSharedCaseRows(null, null), []);
    });
});

describe("shared cases table, columns", () => {
    it("names every author in order, else the case's own author fields", () => {
        assert.equal(sharedCaseAuthor(shared(1, {
            authors: [
                { authorFirstname: "Tomás", authorLastname: "Pérez" },
                { authorFirstname: "", authorLastname: "" },
                { authorFirstname: "Lucía", authorLastname: " Herrera " },
            ],
        })), "Tomás Pérez, Lucía Herrera");
        assert.equal(sharedCaseAuthor({ authorFirstname: "Diego", authorLastname: "Soto" }),
            "Diego Soto");
        assert.equal(sharedCaseAuthor({ authors: [{ authorEmail: "a@b.c" }] }), "");
        assert.equal(sharedCaseAuthor(null), "");
    });

    it("names Creative Commons licenses by their short name and the others by a key", () => {
        assert.deepEqual(sharedCaseLicense("CC-BY-4.0"), { text: "CC BY 4.0" });
        assert.deepEqual(sharedCaseLicense("CC-BY-NC-SA-4.0"), { text: "CC BY-NC-SA 4.0" });
        assert.deepEqual(sharedCaseLicense("ALL_RIGHTS_RESERVED"),
            { key: "cases_shared_license_all_rights_reserved" });
        assert.deepEqual(sharedCaseLicense("COMMERCIAL_LICENSE"),
            { key: "cases_shared_license_commercial" });
        assert.deepEqual(sharedCaseLicense("USED_WITH_PERMISSION"),
            { key: "cases_shared_license_used_with_permission" });
        assert.deepEqual(sharedCaseLicense("CUSTOM"), { key: "cases_shared_license_custom" });
        assert.deepEqual(sharedCaseLicense("MIT"), { text: "MIT" });
        assert.deepEqual(sharedCaseLicense(undefined), { text: "" });
    });

    it("labels every rights status, and an unknown one as unknown", () => {
        for (const status of ["own_work", "open_license", "used_with_permission",
            "commercial_license", "public_domain"]) {
            assert.equal(rightsStatusKey({ rightsStatus: status }), `rights_status_${status}`);
        }
        assert.equal(rightsStatusKey({ rightsStatus: "other" }), "rights_status_unknown");
        assert.equal(rightsStatusKey({}), "rights_status_unknown");
    });
});

describe("shared cases table, search", () => {
    const row = buildSharedCaseRow(shared(5, {
        title:   "La represa del Valle",
        authors: [{ authorFirstname: "Carla", authorLastname: "Muñoz" }],
        tags:    [{ label: "Minería" }, { label: "ambiente" }],
    }), new Map());

    it("matches the title, author and tags, ignoring case and accents", () => {
        assert.equal(sharedCaseMatchesSearch(row, "REPRESA"), true);
        assert.equal(sharedCaseMatchesSearch(row, "munoz"), true);
        assert.equal(sharedCaseMatchesSearch(row, "mineria"), true);
        assert.equal(sharedCaseMatchesSearch(row, "valle  carla"), true);
        assert.equal(sharedCaseMatchesSearch(row, "puente"), false);
        assert.equal(sharedCaseMatchesSearch(row, "valle puente"), false);
    });

    it("matches everything with an empty search", () => {
        assert.equal(sharedCaseMatchesSearch(row, "  "), true);
        assert.equal(sharedCaseMatchesSearch(row, undefined), true);
    });
});
