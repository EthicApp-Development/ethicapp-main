import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    activityDocumentTitle,
    activityDocumentTitleKeeper,
    activityTitleParts,
    activityTitleText,
} from "../activity-title.js";

// Two activities launched from the same design (#973).
const SECTION_3 = {
    name:        "Privacidad en apps de salud",
    description: "Ética Profesional · Sección 3 · 2026-2",
};
const SECTION_5 = { ...SECTION_3, description: "Ética Profesional · Sección 5 · 2026-2" };

describe("activityTitleParts", () => {
    it("gives the name and the description", () => {
        assert.deepEqual(activityTitleParts(SECTION_3), {
            name:        "Privacidad en apps de salud",
            description: "Ética Profesional · Sección 3 · 2026-2",
        });
    });

    it("trims them and puts them on one line", () => {
        assert.deepEqual(activityTitleParts({ name: "  Dilemas\néticos ", description: "\tSección 1\n\n2026 " }), {
            name:        "Dilemas éticos",
            description: "Sección 1 2026",
        });
    });

    it("leaves a missing or blank part empty", () => {
        for (const description of [undefined, null, "", "   ", 42]) {
            assert.deepEqual(activityTitleParts({ name: "Caso", description }), { name: "Caso", description: "" });
        }
        assert.deepEqual(activityTitleParts(undefined), { name: "", description: "" });
        assert.deepEqual(activityTitleParts(null), { name: "", description: "" });
    });
});

describe("activityTitleText", () => {
    it("puts the description after the name", () => {
        assert.equal(activityTitleText(SECTION_3),
            "Privacidad en apps de salud · Ética Profesional · Sección 3 · 2026-2");
    });

    it("tells apart two activities of the same design", () => {
        assert.notEqual(activityTitleText(SECTION_3), activityTitleText(SECTION_5));
    });

    it("shows the name alone for an activity without a description", () => {
        assert.equal(activityTitleText({ name: "Caso", description: "" }), "Caso");
        assert.equal(activityTitleText({ name: "Caso", description: null }), "Caso");
        assert.equal(activityTitleText({ name: "Caso" }), "Caso");
    });

    it("shows the description alone without a name, and nothing without either", () => {
        assert.equal(activityTitleText({ name: "", description: "Sección 3" }), "Sección 3");
        assert.equal(activityTitleText({}), "");
        assert.equal(activityTitleText(undefined), "");
    });
});

describe("activityDocumentTitle", () => {
    it("puts the activity's title before the page's own", () => {
        assert.equal(activityDocumentTitle(SECTION_3, "EthicApp"),
            "Privacidad en apps de salud · Ética Profesional · Sección 3 · 2026-2 – EthicApp");
        assert.equal(activityDocumentTitle({ name: "Caso" }, "EthicApp"), "Caso – EthicApp");
    });

    it("keeps the page's title while the activity has none", () => {
        assert.equal(activityDocumentTitle(undefined, "EthicApp"), "EthicApp");
        assert.equal(activityDocumentTitle({ name: " " }, "EthicApp"), "EthicApp");
    });

    it("gives the activity's title alone without a page title", () => {
        assert.equal(activityDocumentTitle({ name: "Caso" }), "Caso");
        assert.equal(activityDocumentTitle({ name: "Caso" }, null), "Caso");
    });
});

describe("activityDocumentTitleKeeper", () => {
    it("titles the tab by the activity and puts the title back", () => {
        const doc = { title: "EthicApp" };
        const keeper = activityDocumentTitleKeeper(doc);

        keeper.show(SECTION_3);
        assert.equal(doc.title, "Privacidad en apps de salud · Ética Profesional · Sección 3 · 2026-2 – EthicApp");
        keeper.show(SECTION_5);
        assert.equal(doc.title, "Privacidad en apps de salud · Ética Profesional · Sección 5 · 2026-2 – EthicApp");

        keeper.restore();
        assert.equal(doc.title, "EthicApp");
    });

    it("ignores an activity that loads after the page is left", () => {
        const doc = { title: "EthicApp" };
        const keeper = activityDocumentTitleKeeper(doc);
        keeper.restore();

        doc.title = "Next page";
        keeper.show(SECTION_3);
        keeper.restore();
        assert.equal(doc.title, "Next page");
    });

    it("does nothing without a document", () => {
        const keeper = activityDocumentTitleKeeper(undefined);
        assert.doesNotThrow(() => {
            keeper.show(SECTION_3);
            keeper.restore();
        });
    });
});
