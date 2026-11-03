// A case becomes public only once its author confirms that the teachers who
// use it keep access after it is made private again (#939, epic #923).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
    casePublicationSummary,
    confirmCasePublication,
    isCasePublication,
} from "../case-publication.js";

function locale(name) {
    const url = new URL(`../../../locales/${name}.json`, import.meta.url);
    return JSON.parse(readFileSync(url, "utf8"));
}

function countingConfirm(answer) {
    const calls = { count: 0 };
    const confirm = async () => {
        calls.count += 1;
        if (answer instanceof Error) {
            throw answer;
        }
        return answer;
    };
    return { calls, confirm };
}

describe("isCasePublication", () => {
    it("is true when a case that was not public becomes public", () => {
        assert.equal(isCasePublication("private", "public"), true);
        assert.equal(isCasePublication(null, "public"), true);
        assert.equal(isCasePublication(undefined, "public"), true);
    });

    it("is false for any other change", () => {
        assert.equal(isCasePublication("public", "public"), false);
        assert.equal(isCasePublication("public", "private"), false);
        assert.equal(isCasePublication("private", "private"), false);
        assert.equal(isCasePublication(null, "private"), false);
    });
});

describe("confirmCasePublication", () => {
    it("goes ahead when the author confirms a publication", async () => {
        const { calls, confirm } = countingConfirm(true);

        assert.equal(await confirmCasePublication("private", "public", confirm), true);
        assert.equal(calls.count, 1);
    });

    it("stops when the author cancels a publication", async () => {
        const { calls, confirm } = countingConfirm(false);

        assert.equal(await confirmCasePublication(null, "public", confirm), false);
        assert.equal(calls.count, 1);
    });

    it("stops on anything but an explicit confirmation", async () => {
        const { confirm } = countingConfirm("yes");

        assert.equal(await confirmCasePublication("private", "public", confirm), false);
    });

    it("stops when the dialog fails", async () => {
        const { confirm } = countingConfirm(new Error("template not found"));
        const originalError = console.error;
        console.error = () => {};

        try {
            assert.equal(await confirmCasePublication("private", "public", confirm), false);
        } finally {
            console.error = originalError;
        }
    });

    it("does not ask for a change that is not a publication", async () => {
        const { calls, confirm } = countingConfirm(false);

        assert.equal(await confirmCasePublication("public", "private", confirm), true);
        assert.equal(await confirmCasePublication("private", "private", confirm), true);
        assert.equal(await confirmCasePublication("public", "public", confirm), true);
        assert.equal(calls.count, 0);
    });
});

describe("casePublicationSummary", () => {
    it("names the case, its authors, language, visibility and tags", () => {
        const tags = [{ id: 3, label: "Privacidad" }];
        const authors = [
            { authorFirstname: "Ana", authorLastname: "Rojas" },
            { authorFirstname: "Luis", authorLastname: "Soto" },
        ];
        const summary = casePublicationSummary({
            title:        "Datos de pacientes",
            authors,
            languageCode: "es_CL",
            visibility:   "private",
            tags,
        });

        assert.deepEqual(summary, {
            title:         "Datos de pacientes",
            authors:       "Ana Rojas; Luis Soto",
            languageCode:  "es_CL",
            visibilityKey: "visibility_private",
            tags,
        });
    });

    it("falls back on the case's own author fields, and says when it is public", () => {
        const summary = casePublicationSummary({
            title:           "Caso",
            authorFirstname: "Ana",
            authorLastname:  "Rojas",
            visibility:      "public",
        });

        assert.equal(summary.authors, "Ana Rojas");
        assert.equal(summary.visibilityKey, "visibility_public");
        assert.deepEqual(summary.tags, []);
    });

    it("is empty for a missing case", () => {
        assert.deepEqual(casePublicationSummary(null), {
            title:         "",
            authors:       "",
            languageCode:  "",
            visibilityKey: "visibility_private",
            tags:          [],
        });
    });
});

describe("the case publication modal", () => {
    it("shows its own case summary, not the retired case card (#1020)", () => {
        const url = new URL(
            "../../../static/views/teacher/fragments/case-publication-settings-modal.template.html",
            import.meta.url);
        const template = readFileSync(url, "utf8");

        assert.match(template, /class="case-publication-summary"/u);
        assert.doesNotMatch(template, /<case-card/u);
    });
});

describe("the publication notice texts", () => {
    it("are translated in es_CL and en_US", () => {
        const keys = [
            "case_publication_notice_title",
            "case_publication_notice_body",
            "case_publication_notice_private_later",
            "case_publication_notice_confirm",
            "case_visibility_public_help",
        ];
        for (const name of ["es_CL", "en_US"]) {
            const catalog = locale(name);
            for (const key of keys) {
                assert.ok(catalog[key], `${name}: ${key}`);
            }
        }
    });
});
