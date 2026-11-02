import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { designCreatedAt, designUsesAiServices } from "../design-list-fields.js";

describe("designCreatedAt (#967)", () => {
    it("returns the ISO string of the Date pg reads", () => {
        assert.equal(
            designCreatedAt(new Date("2026-11-01T12:34:56.789Z")),
            "2026-11-01T12:34:56.789Z",
        );
    });

    it("normalizes a timestamp string to ISO", () => {
        assert.equal(designCreatedAt("2026-11-01 09:34:56.789-03"), "2026-11-01T12:34:56.789Z");
    });

    it("returns null for a design created before the column existed", () => {
        assert.equal(designCreatedAt(null), null);
        assert.equal(designCreatedAt(undefined), null);
        assert.equal(designCreatedAt(""), null);
    });

    it("returns null for a value that is not a date", () => {
        assert.equal(designCreatedAt("not a date"), null);
        assert.equal(designCreatedAt(new Date(Number.NaN)), null);
    });
});

describe("designUsesAiServices (#967)", () => {
    it("is true when some phase enables a service", () => {
        const design = {
            phases: [
                { externalServices: { enabledServiceIds: [] } },
                { externalServices: { enabledServiceIds: ["mock-chat-agent"] } },
            ],
        };
        assert.equal(designUsesAiServices(design), true);
    });

    it("is false when no phase enables a service", () => {
        const design = {
            phases: [
                {},
                { externalServices: { enabledServiceIds: [] } },
                { externalServices: { enabledServiceIds: ["  ", ""] } },
                // Configurations of services that are not enabled do not count.
                {
                    externalServices: {
                        configurations: { "mock-chat-agent": { llm_tier: "basic" } },
                    },
                },
            ],
        };
        assert.equal(designUsesAiServices(design), false);
    });

    it("is false for a design without phases or without a document", () => {
        assert.equal(designUsesAiServices({}), false);
        assert.equal(designUsesAiServices({ phases: null }), false);
        assert.equal(designUsesAiServices(null), false);
        assert.equal(designUsesAiServices(undefined), false);
    });
});
