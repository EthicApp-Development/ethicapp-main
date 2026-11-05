// Whether the empty page of a teacher with no activities shows step 1,
// "Prepara un diseño" (#1053, #1098): left out when a design is ready to
// launch by the launch wizard's rule, kept when the designs cannot be loaded.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { designStepNeeded } from "../activities-empty-page.js";

function design(id, fields = {}) {
    return { id, userOwned: true, archived: false, valid: true, ...fields };
}

function catalogOf(designs, { loaded = true, fail = false } = {}) {
    const calls = { loads: 0 };
    return {
        calls,
        async loadDesigns() {
            calls.loads += 1;
            if (fail) {
                throw new Error("network");
            }
            return loaded;
        },
        getDesigns: async () => designs,
    };
}

async function quietly(run) {
    const { error } = console;
    console.error = () => {};
    try {
        return await run();
    } finally {
        console.error = error;
    }
}

describe("designStepNeeded", () => {
    it("is needed when the teacher has no designs", async () => {
        const designs = catalogOf([]);
        assert.equal(await designStepNeeded(designs), true);
        assert.equal(designs.calls.loads, 1);
    });

    it("is not needed when a design is ready to launch", async () => {
        assert.equal(await designStepNeeded(catalogOf([design(1, { valid: false }), design(2)])),
            false);
    });

    it("is needed when the only designs have errors, are archived or are others'", async () => {
        assert.equal(await designStepNeeded(catalogOf([
            design(1, { valid: false }),
            design(2, { archived: true }),
            design(3, { userOwned: false, visibility: "public" }),
        ])), true);
    });

    it("is needed when the designs cannot be loaded", async () => {
        assert.equal(await designStepNeeded(catalogOf([design(2)], { loaded: false })), true);
        assert.equal(await quietly(() => designStepNeeded(catalogOf([design(2)], { fail: true }))),
            true);
    });
});
