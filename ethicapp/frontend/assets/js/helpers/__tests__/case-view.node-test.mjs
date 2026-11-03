// The case view (#1018, epic #1008): status, actions, chips, uses and rights
// from GET /cases/:id and GET /cases/:id/uses.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    CASE_VIEW_ACTION_IMPORT,
    CASE_VIEW_ACTION_VIEW_COPY,
    buildCaseView,
    caseAuthorsLine,
    caseMaterialCount,
    caseViewActions,
    caseViewChips,
    caseViewRights,
    caseViewStatus,
    caseViewStatusLabel,
    caseViewUses,
    formatCaseDate,
    isCaseAuthor,
    isCaseImportable,
    licenseLabel,
} from "../case-view.js";

function caseItem(fields = {}) {
    return {
        id:           7,
        title:        "Patient data in the cloud",
        creator:      650,
        visibility:   "private",
        public:       false,
        archived:     false,
        languageCode: "es_CL",
        licenseCode:  "CC-BY-NC-SA-4.0",
        rightsStatus: "own_work",
        authors:      [
            { authorFirstname: "Ana", authorLastname: "Pérez", authorEmail: "ana@example.org" },
        ],
        createdAt: "2026-08-12T15:00:00Z",
        ...fields,
    };
}

const AUTHOR_USES = {
    ownDesigns:           [{ id: 11, title: "Health apps", archived: false }],
    activityCount:        0,
    otherDesignCount:     0,
    otherTeacherCount:    0,
    designsKeepingAccess: 0,
};

describe("isCaseAuthor", () => {
    it("compares the case's creator with the profile", () => {
        assert.equal(isCaseAuthor(caseItem(), { id: 650 }, null), true);
        assert.equal(isCaseAuthor(caseItem(), { id: "650" }, null), true);
        assert.equal(isCaseAuthor(caseItem(), { id: 651 }, AUTHOR_USES), false);
        assert.equal(isCaseAuthor(caseItem({ creator: null }), { id: 650 }, null), false);
    });

    it("falls back on the uses answer without a profile", () => {
        assert.equal(isCaseAuthor(caseItem(), null, AUTHOR_USES), true);
        assert.equal(isCaseAuthor(caseItem(), null, { ownDesigns: [], activityCount: 0 }), false);
        assert.equal(isCaseAuthor(caseItem(), null, null), false);
    });
});

describe("caseViewStatus", () => {
    it("counts the author's activities from the uses answer", () => {
        const info = caseViewStatus(caseItem(), { ...AUTHOR_USES, activityCount: 3 },
            { isAuthor: true });
        assert.equal(info.status, "in-use");
        assert.equal(info.activityCount, 3);
        assert.deepEqual(caseViewStatusLabel(info),
            { key: "cases_status_in_use_other", params: { count: 3 }, tone: "in-use" });
    });

    it("keeps a case in use locked when the uses answer failed", () => {
        const info = caseViewStatus(caseItem({ hasLaunchedDesignActivity: true }), null,
            { isAuthor: true });
        assert.equal(info.status, "in-use");
        assert.equal(caseViewStatusLabel(info).key, "case_view_status_in_use");
    });

    it("describes only the document to another teacher", () => {
        const failed = caseItem({ documentProcessing: { status: "failed" } });
        const info = caseViewStatus(failed, { ownDesigns: [], activityCount: 4 },
            { isAuthor: false });
        assert.equal(info.status, "pdf-error");
        assert.equal(info.activityCount, 0);
    });
});

describe("caseViewActions", () => {
    it("follows the row's rule for the author", () => {
        const ready = caseViewActions({ status: "ready" }, { isAuthor: true });
        assert.equal(ready.primary.id, "edit");
        assert.deepEqual(ready.menu.map(entry => entry.id), ["duplicate", "archive", "delete"]);

        assert.equal(caseViewActions({ status: "in-use", activityCount: 2 }, { isAuthor: true })
            .primary.id, "duplicate-to-edit");
        assert.equal(caseViewActions({ status: "pdf-error" }, { isAuthor: true })
            .primary.id, "replace-pdf");
    });

    it("ends the author's menu with Delete, disabled with its reason", () => {
        const open = caseViewActions({ status: "ready" }, { isAuthor: true }).menu.at(-1);
        assert.equal(open.id, "delete");
        assert.equal(open.danger, true);
        assert.equal(open.disabled, false);
        assert.equal(open.reason, null);

        const inUse = caseViewActions({ status: "in-use", activityCount: 2 }, { isAuthor: true })
            .menu.at(-1);
        assert.deepEqual(inUse.reason, { key: "cases_delete_in_use_other", params: { count: 2 } });

        const kept = caseViewActions({ status: "ready" }, {
            isAuthor: true, usage: { otherDesignCount: 1, otherTeacherCount: 1 },
        }).menu.at(-1);
        assert.equal(kept.disabled, true);
        assert.equal(kept.reason.key, "cases_delete_used_by_others_one");

        // The uses answer failed: in use, count unknown.
        const unknown = caseViewActions({ status: "in-use", activityCount: 0 }, { isAuthor: true })
            .menu.at(-1);
        assert.deepEqual(unknown.reason, { key: "case_view_delete_in_use", params: {} });
    });

    it("offers Restore instead of Archive for an archived case", () => {
        const archived = caseViewActions({ status: "ready", archived: true }, { isAuthor: true });
        assert.equal(archived.primary.id, "edit");
        assert.deepEqual(archived.menu.map(entry => entry.id), ["duplicate", "restore", "delete"]);
    });

    it("offers another teacher Import, or their copy", () => {
        assert.equal(caseViewActions({ status: "ready" }, { importable: true }).primary.id,
            CASE_VIEW_ACTION_IMPORT);
        assert.equal(caseViewActions({ status: "ready" }, { importable: false }).primary, null);

        const copied = caseViewActions({ status: "ready" },
            { importable: true, importedCopy: { id: 31 } });
        assert.equal(copied.primary.id, CASE_VIEW_ACTION_VIEW_COPY);
        assert.equal(copied.primary.href, "#!/cases/31");
        assert.deepEqual(copied.menu, []);
    });

    it("imports only another teacher's shared, active case", () => {
        const shared = caseItem({ visibility: "public", public: true });
        assert.equal(isCaseImportable(shared), true);
        assert.equal(isCaseImportable(shared, { isAuthor: true }), false);
        assert.equal(isCaseImportable({ ...shared, archived: true }), false);
        assert.equal(isCaseImportable(caseItem()), false);
    });
});

describe("caseViewChips", () => {
    it("lists status, sharing, language, license, rights, material and tags", () => {
        const item = caseItem({
            visibility:         "public",
            documentProcessing: { status: "completed", pageCount: 6 },
            videos:             [{ youtubeVideoId: "a" }],
            tags:               [
                { id: 1, label: "privacy", categoryLabel: "Topic" },
                { id: 2, label: " " },
            ],
        });
        const chips = caseViewChips(item, { status: "ready" }, new Map([["es_CL", "Español"]]));

        assert.deepEqual(chips.map(chip => chip.kind),
            ["status", "sharing", "language", "license", "rights", "material", "tag"]);
        assert.equal(chips[1].tone, "shared");
        assert.deepEqual(chips[2].parts, [{ text: "Español" }]);
        assert.deepEqual(chips[3].parts, [{ text: "CC BY-NC-SA 4.0" }]);
        assert.equal(chips[4].parts[0].key, "rights_status_own_work");
        assert.deepEqual(chips[5].parts.map(part => part.key),
            ["cases_meta_pages_other", "cases_meta_videos_one"]);
        assert.equal(chips[6].title, "Topic");
    });

    it("marks an archived, private case without material", () => {
        const chips = caseViewChips(caseItem({ rightsStatus: null }),
            { status: "ready", archived: true });
        assert.deepEqual(chips.map(chip => chip.kind),
            ["status", "archived", "sharing", "language", "license", "rights"]);
        assert.equal(chips[2].tone, "private");
        assert.deepEqual(chips[3].parts, [{ text: "es_CL" }]);
        assert.equal(chips[5].parts[0].key, "rights_status_unknown");
    });
});

describe("licenseLabel", () => {
    it("names Creative Commons licenses and translates the others", () => {
        assert.deepEqual(licenseLabel("CC-BY-4.0"), { text: "CC BY 4.0" });
        assert.deepEqual(licenseLabel("ALL_RIGHTS_RESERVED"),
            { key: "case_view_license_all_rights_reserved", params: {} });
        assert.deepEqual(licenseLabel("SOMETHING"), { text: "SOMETHING" });
        assert.equal(licenseLabel(""), null);
    });
});

describe("caseViewUses", () => {
    it("tells the author how many designs use the case and whose", () => {
        const uses = caseViewUses({
            ...AUTHOR_USES,
            ownDesigns: [
                { id: 11, title: "Health apps", archived: false },
                { id: 12, title: null, archived: true },
            ],
            otherDesignCount:  1,
            otherTeacherCount: 1,
        }, caseItem({ visibility: "public" }), { isAuthor: true });

        assert.equal(uses.none, false);
        assert.deepEqual(uses.summary, { key: "case_view_uses_total_other", params: { count: 3 } });
        assert.deepEqual(uses.breakdown.map(part => part.key),
            ["case_view_uses_own_other", "case_view_uses_others_one"]);
        assert.deepEqual(uses.designs, [
            { id: 11, title: "Health apps", archived: false, href: "#!/designs/11" },
            { id: 12, title: null, archived: true, href: "#!/designs/12" },
        ]);
        assert.deepEqual(uses.othersTail,
            { key: "case_view_uses_and_others_one", params: { count: 1 } });
        assert.equal(uses.kept, null);
    });

    it("says that other teachers keep a private case", () => {
        const uses = caseViewUses({
            ...AUTHOR_USES, ownDesigns: [], otherDesignCount: 9, designsKeepingAccess: 9,
        }, caseItem(), { isAuthor: true });

        assert.equal(uses.othersTail, null);
        assert.deepEqual(uses.breakdown.map(part => part.key), ["case_view_uses_others_other"]);
        assert.deepEqual(uses.kept, { key: "case_view_uses_kept_other", params: { count: 9 } });
    });

    it("says when no design uses the case", () => {
        const uses = caseViewUses({ ...AUTHOR_USES, ownDesigns: [] }, caseItem(),
            { isAuthor: true });
        assert.equal(uses.none, true);
        assert.equal(uses.summary.key, "case_view_uses_none");
        assert.deepEqual(uses.breakdown, []);
    });

    it("shows another teacher only their own designs", () => {
        const uses = caseViewUses({
            ownDesigns:       [{ id: 21, title: "Mine", archived: false }],
            activityCount:    1,
            // Never sent to another teacher; ignored if it were.
            otherDesignCount: 5,
        }, caseItem(), { isAuthor: false });

        assert.deepEqual(uses.summary, { key: "case_view_uses_yours_one", params: { count: 1 } });
        assert.deepEqual(uses.breakdown, []);
        assert.equal(uses.othersTail, null);
        assert.equal(uses.kept, null);
        assert.deepEqual(uses.designs.map(design => design.id), [21]);

        const none = caseViewUses({ ownDesigns: [], activityCount: 0 }, caseItem());
        assert.equal(none.summary.key, "case_view_uses_yours_none");
    });

    it("is null without the uses answer", () => {
        assert.equal(caseViewUses(null, caseItem(), { isAuthor: true }), null);
    });
});

describe("caseViewRights", () => {
    it("lists the authors, the license and the filled details", () => {
        const rights = caseViewRights(caseItem({
            attributionText:       "By Ana",
            licenseNotes:          "  ",
            permissionStatement:   "Granted",
            sourceCaseTitle:       "Original",
            sourceCaseAuthor:      "Luis",
            sourceCaseLicenseCode: "CC-BY-4.0",
        }), [{
            code: "CC-BY-NC-SA-4.0",
            name: "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International",
            url:  "https://creativecommons.org/licenses/by-nc-sa/4.0/",
        }]);

        assert.deepEqual(rights.authors, [{ name: "Ana Pérez", email: "ana@example.org" }]);
        assert.equal(rights.license.href, "https://creativecommons.org/licenses/by-nc-sa/4.0/");
        assert.match(rights.license.label.text, /^Creative Commons/u);
        assert.equal(rights.rightsStatusKey, "rights_status_own_work");
        assert.deepEqual(rights.details, [
            { labelKey: "attribution_text", text: "By Ana" },
            { labelKey: "permission_statement", text: "Granted" },
        ]);
        assert.deepEqual(rights.source,
            { title: "Original", author: "Luis", license: { text: "CC BY 4.0" } });
    });

    it("falls back on the license's code without the catalog", () => {
        const rights = caseViewRights(caseItem({ authors: [], authorFirstname: "Eva" }));
        assert.deepEqual(rights.license, { label: { text: "CC BY-NC-SA 4.0" }, href: null });
        assert.deepEqual(rights.authors, [{ name: "Eva", email: "" }]);
        assert.deepEqual(rights.details, []);
        assert.equal(rights.source, null);
    });
});

describe("the head", () => {
    it("names the authors and the creation date in the UI language", () => {
        assert.equal(caseAuthorsLine(caseItem({ authors: [
            { authorFirstname: "Ana", authorLastname: "Pérez" },
            { authorFirstname: "Luis" },
        ] })), "Ana Pérez; Luis");
        assert.equal(formatCaseDate("2026-08-12T15:00:00Z", "es_CL"), "12 de agosto de 2026");
        assert.equal(formatCaseDate("2026-08-12T15:00:00Z", "en_US"), "August 12, 2026");
        assert.equal(formatCaseDate("not a date", "en_US"), "");
    });

    it("counts the material for its tab", () => {
        assert.equal(caseMaterialCount(caseItem({ videos: [{}], documents: [{}, {}] })), 3);
        assert.equal(caseMaterialCount(caseItem()), 0);
    });
});

describe("buildCaseView", () => {
    it("puts the pieces together for the author of a case in use", () => {
        const view = buildCaseView({
            caseItem: caseItem(),
            uses:     { ...AUTHOR_USES, activityCount: 2 },
            isAuthor: true,
        });
        assert.equal(view.id, 7);
        assert.equal(view.title, "Patient data in the cloud");
        assert.equal(view.primary.id, "duplicate-to-edit");
        assert.equal(view.chips[0].tone, "in-use");
        assert.equal(view.uses.summary.key, "case_view_uses_total_one");
        assert.equal(view.materialCount, 0);
    });
});
