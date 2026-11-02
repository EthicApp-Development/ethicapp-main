// The "Shared by others" tab (#977, epic #966): each row's details and its
// import state, the search, and the notice after an import.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildSharedRow,
    buildSharedRows,
    importNotice,
    sharedDesignAuthor,
    sharedRowMatchesSearch,
} from "../designs-shared-table.js";

function shared(id, fields = {}) {
    return {
        id,
        userOwned:  false,
        valid:      true,
        visibility: "public",
        metainfo:   { title: `Shared ${id}`, authorName: "Andrea Rojas" },
        ...fields,
    };
}

describe("shared designs table, rows", () => {
    it("shows the phases, case, author and license", () => {
        const row = buildSharedRow(shared(5, {
            phases:         [{}, {}, {}],
            associatedCase: { title: "La foto viral" },
            licenseCode:    "CC BY-SA 4.0",
        }), new Map());
        assert.equal(row.id, 5);
        assert.equal(row.title, "Shared 5");
        assert.equal(row.phaseCount, 3);
        assert.equal(row.caseTitle, "La foto viral");
        assert.equal(row.author, "Andrea Rojas");
        assert.equal(row.licenseCode, "CC BY-SA 4.0");
        assert.equal(row.importState, "importable");
        assert.equal(row.copyId, null);
    });

    it("leaves an unknown author empty", () => {
        assert.equal(sharedDesignAuthor({ metainfo: { authorName: "unknown unknown" } }), "");
        assert.equal(sharedDesignAuthor({ metainfo: {} }), "");
        assert.equal(sharedDesignAuthor({ metainfo: { authorName: " Tomás Pérez " } }),
            "Tomás Pérez");
    });

    it("marks a design already imported with its copy, and one whose case is not public", () => {
        const designs = [
            shared(5),
            shared(6, { importable: false }),
            shared(7, { importable: false }),
            { id: 20, userOwned: true, importedFromDesignId: 5, metainfo: { title: "Copy" } },
            { id: 21, userOwned: true, importedFromDesignId: 7, metainfo: { title: "Old copy" } },
        ];
        const rows = buildSharedRows(designs.slice(0, 3), designs);
        assert.deepEqual(rows.map(row => [row.id, row.importState, row.copyId]), [
            [5, "imported", 20],
            [6, "not-importable", null],
            [7, "imported", 21],
        ]);
    });

    it("lists nothing without designs", () => {
        assert.deepEqual(buildSharedRows(null, null), []);
    });
});

describe("shared designs table, search", () => {
    const row = buildSharedRow(shared(5, {
        metainfo:       { title: "Ética en la minería", authorName: "Carla Muñoz" },
        associatedCase: { title: "El relave" },
        tags:           [{ label: "minería" }, { label: "ambiente" }],
    }), new Map());

    it("matches the title, author, case and tags, without accents", () => {
        assert.equal(sharedRowMatchesSearch(row, "etica"), true);
        assert.equal(sharedRowMatchesSearch(row, "munoz"), true);
        assert.equal(sharedRowMatchesSearch(row, "relave"), true);
        assert.equal(sharedRowMatchesSearch(row, "ambiente carla"), true);
        assert.equal(sharedRowMatchesSearch(row, "puente"), false);
    });

    it("matches everything with an empty search", () => {
        assert.equal(sharedRowMatchesSearch(row, "  "), true);
        assert.equal(sharedRowMatchesSearch(row, undefined), true);
    });
});

describe("shared designs table, the notice after an import", () => {
    it("names the copy by its own title", () => {
        const designs = [{ id: 99, metainfo: { title: "Shared 5 (copia)" } }];
        assert.deepEqual(importNotice(99, designs, "Shared 5"),
            { copyId: 99, title: "Shared 5 (copia)" });
    });

    it("falls back to the shared design's title when the copy is not listed", () => {
        assert.deepEqual(importNotice(99, [], "Shared 5"), { copyId: 99, title: "Shared 5" });
    });
});
