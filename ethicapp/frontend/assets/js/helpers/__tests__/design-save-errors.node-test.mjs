import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { designSaveErrorMessageKey, isCaseNotAvailableError } from "../design-save-errors.js";

describe("designSaveErrorMessageKey (#730)", () => {
    it("explains a save refused because the design is locked", () => {
        const rejection = { status: 409, data: { status: "err", code: "DESIGN_LOCKED" } };

        assert.equal(designSaveErrorMessageKey(rejection), "save_design_locked");
    });

    it("explains a save refused because of external service settings (#731)", () => {
        const rejection = {
            status: 400,
            data:   { status: "err", code: "INVALID_SERVICE_CONFIGURATION" },
        };

        assert.equal(designSaveErrorMessageKey(rejection), "save_design_invalid_service_settings");
    });

    it("explains a save refused because the case is not available (#924)", () => {
        const rejection = { status: 404, data: { status: "err", code: "CASE_NOT_AVAILABLE" } };

        assert.equal(designSaveErrorMessageKey(rejection), "save_design_case_not_available");
    });

    it("falls back to the generic failure otherwise", () => {
        const errors = [
            { status: 409, data: { code: "CASE_VISIBILITY_REQUIRED" } },
            { status: 500, data: { code: "DESIGN_LOCKED" } },
            { status: 409, data: { code: "INVALID_SERVICE_CONFIGURATION" } },
            { status: 409, data: { code: "CASE_NOT_AVAILABLE" } },
            { status: 404, data: { status: "err", message: "Design not found" } },
            { status: -1, data: null },
            new Error("Cannot save a null design"),
            undefined,
        ];

        for (const error of errors) {
            assert.equal(designSaveErrorMessageKey(error), "save_design_failure",
                String(error?.status));
        }
    });
});

describe("isCaseNotAvailableError (#924)", () => {
    it("is true only for the 404 CASE_NOT_AVAILABLE refusal", () => {
        assert.equal(isCaseNotAvailableError({ status: 404, data: { code: "CASE_NOT_AVAILABLE" } }),
            true);

        const others = [
            { status: 404, data: { message: "Design not found" } },
            { status: 409, data: { code: "CASE_NOT_AVAILABLE" } },
            { status: 409, data: { code: "CASE_VISIBILITY_REQUIRED" } },
            { status: -1, data: null },
            new Error("Cannot save a null design"),
            undefined,
        ];
        for (const error of others) {
            assert.equal(isCaseNotAvailableError(error), false, String(error?.status));
        }
    });
});
