import assert from "node:assert/strict";
import test from "node:test";

import { buildCsv } from "../csv-builder.js";

test("buildCsv prefixes UTF-8 output with a BOM for spreadsheet compatibility", () => {
    const csv = buildCsv(
        ["name", "comment"],
        [{ name: "Joaquín", comment: "A decision by \"peers\"" }]
    );

    assert.equal(csv.codePointAt(0), 0xFEFF);
    assert.equal(
        csv.slice(1),
        "\"name\",\"comment\"\n\"Joaquín\",\"A decision by \"\"peers\"\"\"\n"
    );
});
