// The case view (#1018, epic #1008): the author's actions follow the case's
// status, another teacher can import the case or open their copy, and the
// uses panel never names other teachers' designs. AngularJS services are
// fakes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { CaseViewController } from "../case-view.controller.js";

const template = readFileSync(new URL(
    "../../../../static/views/teacher/cases.view.html", import.meta.url), "utf8");

const TEACHER_ID = 650;

function caseItem(fields = {}) {
    return {
        id:                 7,
        title:              "Patient data in the cloud",
        creator:            TEACHER_ID,
        visibility:         "private",
        public:             false,
        archived:           false,
        languageCode:       "es_CL",
        licenseCode:        "CC-BY-NC-SA-4.0",
        rightsStatus:       "own_work",
        authors:            [{ authorFirstname: "Ana", authorLastname: "Pérez" }],
        createdAt:          "2026-08-12T15:00:00Z",
        documentProcessing: { status: "completed", pageCount: 6 },
        ...fields,
    };
}

function authorUses(fields = {}) {
    return {
        ownDesigns:           [{ id: 11, title: "Health apps", archived: false }],
        activityCount:        0,
        otherDesignCount:     0,
        otherTeacherCount:    0,
        designsKeepingAccess: 0,
        ...fields,
    };
}

function createView({
    routeId = "7", item = caseItem(), uses = authorUses(), profile = { id: TEACHER_ID },
    own = [], archived = [], catalog = {},
} = {}) {
    const scopeHandlers = {};
    const calls = {
        navigated:  [], toasts:     [], duplicated: [], archived:   [], imported:   [],
        listed:     [], intervals:  [], cancelled:  [], loadedCase: 0,
    };

    const $scope = {
        $on(name, handler) {
            (scopeHandlers[name] ||= []).push(handler);
        },
        $applyAsync(fn) {
            fn?.();
        },
        navigateTo(path) {
            calls.navigated.push(path);
        },
    };
    const $translate = { instant: key => key };
    const $interval = (fn, delay) => {
        const timer = { fn, delay };
        calls.intervals.push(timer);
        return timer;
    };
    $interval.cancel = timer => calls.cancelled.push(timer);
    const toast = { create: options => calls.toasts.push(options) };

    const CasesCatalogService = {
        getCaseById: async () => {
            calls.loadedCase += 1;
            return item;
        },
        getCaseUses: async () => {
            if (uses instanceof Error) {
                throw uses;
            }
            return uses;
        },
        getLicenses: async () => [],
        getCases:    async () => {
            calls.listed.push("own");
            return own;
        },
        getArchivedCases: async () => {
            calls.listed.push("archived");
            return archived;
        },
        duplicateCase: async (id) => {
            calls.duplicated.push(id);
            return { id: 99 };
        },
        updateCaseArchived: async (id, value) => {
            calls.archived.push([id, value]);
            return { id, archived: value };
        },
        importCase: async (id) => {
            calls.imported.push(id);
            return { id: 98, importedFromCaseId: id };
        },
        getCaseDocumentProcessing: async () => ({ documentProcessing: { status: "completed" } }),
        ...catalog,
    };
    const LanguageCatalogService = {
        getLanguages:             async () => [{ code: "es_CL", native_name: "Español" }],
        getCurrentUiLanguageCode: () => "es_CL",
    };
    const UserProfileService = { getProfile: async () => profile };
    const CasesListLocationService = { lastHref: () => "#!/cases?tab=archived&q=salud" };

    const vm = {};
    CaseViewController.call(vm, $scope, { id: routeId }, $interval, $translate, toast,
        CasesCatalogService, LanguageCatalogService, UserProfileService, CasesListLocationService);

    return { vm, calls, scopeHandlers };
}

function quietly(run) {
    const { error, warn } = console;
    console.error = () => {};
    console.warn = () => {};
    return Promise.resolve(run()).finally(() => {
        console.error = error;
        console.warn = warn;
    });
}

describe("CaseViewController", () => {
    it("returns to the list as the teacher left it", () => {
        const { vm } = createView();
        assert.equal(vm.backHref, "#!/cases?tab=archived&q=salud");
    });

    it("gives the author the row's actions and their designs", async () => {
        const { vm, calls } = createView({
            uses: authorUses({ otherDesignCount: 1, otherTeacherCount: 1 }),
        });
        await vm.ready;

        assert.equal(vm.loaded, true);
        assert.equal(vm.view.isAuthor, true);
        assert.equal(vm.view.primary.id, "edit");
        assert.deepEqual(vm.view.menu.map(entry => entry.id), ["duplicate", "archive"]);
        assert.equal(vm.view.chips[0].tone, "ready");
        assert.deepEqual(vm.view.uses.summary,
            { key: "case_view_uses_total_other", params: { count: 2 } });
        assert.deepEqual(vm.view.uses.designs.map(design => design.href), ["#!/designs/11"]);
        // The author's copies are not looked for.
        assert.deepEqual(calls.listed, []);

        await vm.runAction(vm.view.primary);
        assert.deepEqual(calls.navigated, ["/cases/7/edit"]);
    });

    it("duplicates a case in use into the editor", async () => {
        const { vm, calls } = createView({ uses: authorUses({ activityCount: 3 }) });
        await vm.ready;

        assert.equal(vm.view.statusInfo.status, "in-use");
        assert.equal(vm.view.primary.id, "duplicate-to-edit");

        await vm.runAction(vm.view.primary);
        assert.deepEqual(calls.duplicated, [7]);
        assert.deepEqual(calls.navigated, ["/cases/99/edit"]);

        await vm.runAction(vm.view.menu.find(entry => entry.id === "duplicate"));
        assert.deepEqual(calls.duplicated, [7, 7]);
        assert.deepEqual(calls.navigated, ["/cases/99/edit"]);
        assert.equal(calls.toasts.at(-1).message, "ethical_cases_duplicate_success");
    });

    it("archives and restores the case in place", async () => {
        const { vm, calls } = createView();
        await vm.ready;

        await vm.runAction(vm.view.menu.find(entry => entry.id === "archive"));
        assert.deepEqual(calls.archived, [[7, true]]);
        assert.equal(vm.caseItem.archived, true);
        assert.ok(vm.view.chips.some(chip => chip.kind === "archived"));
        assert.deepEqual(vm.view.menu.map(entry => entry.id), ["duplicate", "restore"]);
        assert.equal(calls.toasts.at(-1).message, "ethical_cases_archive_success");

        await vm.runAction(vm.view.menu.find(entry => entry.id === "restore"));
        assert.deepEqual(calls.archived, [[7, true], [7, false]]);
        assert.equal(vm.caseItem.archived, false);
        assert.equal(calls.toasts.at(-1).message, "ethical_cases_unarchive_success");
    });

    it("opens an archived case with Restore in its menu", async () => {
        const { vm } = createView({ item: caseItem({ archived: true }) });
        await vm.ready;

        assert.equal(vm.view.primary.id, "edit");
        assert.deepEqual(vm.view.menu.map(entry => entry.id), ["duplicate", "restore"]);
    });

    it("lets another teacher import a shared case, then offers the copy", async () => {
        const { vm, calls } = createView({
            item:    caseItem({ creator: 700, visibility: "public", public: true }),
            uses:    { ownDesigns: [{ id: 21, title: "Mine", archived: true }], activityCount: 0 },
            profile: { id: TEACHER_ID },
        });
        await vm.ready;

        assert.equal(vm.view.isAuthor, false);
        assert.deepEqual(calls.listed.sort(), ["archived", "own"]);
        assert.equal(vm.view.primary.id, "import");
        assert.deepEqual(vm.view.menu, []);
        assert.deepEqual(vm.view.uses.summary,
            { key: "case_view_uses_yours_one", params: { count: 1 } });
        assert.deepEqual(vm.view.uses.breakdown, []);
        assert.equal(vm.view.uses.designs[0].archived, true);

        await vm.runAction(vm.view.primary);
        assert.deepEqual(calls.imported, [7]);
        assert.equal(vm.view.primary.id, "view-copy");
        assert.equal(vm.view.primary.href, "#!/cases/98");
        assert.equal(calls.toasts.at(-1).message, "ethical_cases_import_success");
    });

    it("shows another teacher's copy they already have", async () => {
        const { vm } = createView({
            item:     caseItem({ creator: 700, visibility: "public", public: true }),
            uses:     { ownDesigns: [], activityCount: 0 },
            archived: [{ id: 40, importedFromCaseId: 7, archived: true }],
        });
        await vm.ready;

        assert.equal(vm.view.primary.id, "view-copy");
        assert.equal(vm.view.primary.href, "#!/cases/40");
    });

    it("offers no action on another teacher's private case", async () => {
        const { vm } = createView({
            item: caseItem({ creator: 700 }),
            uses: { ownDesigns: [{ id: 21, title: "Mine", archived: false }], activityCount: 2 },
        });
        await vm.ready;

        assert.equal(vm.view.primary, null);
        // Their activities do not lock another teacher's case for them.
        assert.equal(vm.view.statusInfo.status, "ready");
    });

    it("keeps the lock of a case in use when its uses fail", async () => {
        const { vm } = createView({
            item: caseItem({ hasLaunchedDesignActivity: true }),
            uses: new Error("network"),
        });
        await quietly(() => vm.ready);

        assert.equal(vm.usesFailed, true);
        assert.equal(vm.view.uses, null);
        // The profile still says who the author is.
        assert.equal(vm.view.primary.id, "duplicate-to-edit");
        assert.equal(vm.view.chips[0].parts[0].key, "case_view_status_in_use");
    });

    it("says when the case cannot be read", async () => {
        const { vm } = createView({
            catalog: { getCaseById: async () => Promise.reject({ status: 404 }) },
        });
        await quietly(() => vm.ready);

        assert.equal(vm.loaded, true);
        assert.equal(vm.loadErrorKey, "case_view_not_found");
        assert.equal(vm.view, null);
    });

    it("loads the case again once its pages are rendered", async () => {
        const { vm, calls, scopeHandlers } = createView({
            item: caseItem({ documentProcessing: { status: "processing" } }),
        });
        await vm.ready;

        assert.equal(vm.view.chips[0].tone, "processing");
        assert.equal(calls.intervals.length, 1);
        assert.equal(calls.loadedCase, 1);

        await vm.refreshDocumentProcessing();
        assert.equal(calls.loadedCase, 2);

        scopeHandlers.$destroy.forEach(handler => handler());
        assert.deepEqual(calls.cancelled, [calls.intervals[0]]);
    });

    it("runs one action at a time", async () => {
        let finish;
        const { vm, calls } = createView({
            catalog: {
                duplicateCase: () => new Promise((resolve) => {
                    calls.duplicated.push(7);
                    finish = resolve;
                }),
            },
        });
        await vm.ready;
        const duplicateEntry = vm.view.menu[0];

        const first = vm.runAction(duplicateEntry);
        await vm.runAction(duplicateEntry);
        assert.equal(calls.duplicated.length, 1);
        finish({ id: 99 });
        await first;
        assert.equal(vm.busy, false);
    });
});

describe("cases.view.html", () => {
    it("declares the view's controller, its back link and its tabs", () => {
        assert.match(template, /ng-controller="CaseViewController as cv"/u);
        assert.doesNotMatch(template, /ng-controller="CasesController/u);
        assert.doesNotMatch(template, /<case-card/u);
        assert.match(template, /class="case-view-back" ng-href="\{\{ cv\.backHref \}\}"/u);
        assert.match(template,
            /<case-view-tabs[^>]*material-count="cv\.view\.materialCount"[^>]*show-rights="true"/u);
        assert.match(template, /<case-view-material>\s*<case-material/u);
        assert.match(template, /<case-view-rights>/u);
    });
});
