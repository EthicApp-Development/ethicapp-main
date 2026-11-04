// The Activities page's notices (#1052, epic #1046): "Código copiado", "Se
// archivó" with "Deshacer" and "Ver Archivadas", "Se restauró" with "Ver en
// Terminadas", and why an action failed. They name the row's title as plain
// text, stay for a few seconds, can be dismissed, and leave the page on its
// tab. AngularJS services are fakes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { ActivitiesPageController } from "../activities-page.controller.js";
import { NOTICE_TIMEOUT_MS } from "../../../helpers/activity-action-feedback.js";

const noticeTemplate = readFileSync(new URL(
    "../../../../static/views/teacher/fragments/activities-action-notice.template.html",
    import.meta.url), "utf8");

const CATALOG = {
    activities_notice_archived: "Se archivó \"{{title}}\"",
    activities_notice_restored: "Se restauró \"{{title}}\"",
};

function activity(sessionId, fields = {}) {
    return {
        sessionId,
        name:             `Activity ${sessionId}`,
        description:      `Section ${sessionId}`,
        time:             `2026-10-${String(10 + sessionId).padStart(2, "0")}T12:00:00Z`,
        code:             `k${sessionId}`,
        archived:         false,
        status:           "finished",
        designId:         40 + sessionId,
        design:           { metainfo: { title: `Activity ${sessionId}` } },
        caseId:           null,
        caseTitle:        null,
        currentPhase:     null,
        phaseCount:       2,
        participantCount: 3,
        finishedAt:       "2026-10-20T12:00:00Z",
        ...fields,
    };
}

/**
 * `$translate.instant` as angular-translate 2.19 behaves under the teacher
 * app's `sanitizeParameters` strategy: the parameters are HTML-encoded
 * unless the call's fifth argument, the sanitize strategy, is `null`.
 */
function sanitizingInstant(key, params = {}, interpolationId, forceLanguage, strategy) {
    const encode = value => String(value)
        .replace(/<[^>]*>/gu, "")
        .replace(/[^\x20-\x7e]|[&"<>]/gu, char => `&#${char.codePointAt(0)};`);
    const values = strategy === null
        ? params
        : Object.fromEntries(Object.entries(params ?? {}).map(([name, v]) => [name, encode(v)]));
    return (CATALOG[key] ?? key)
        .replace(/\{\{(\w+)\}\}/gu, (match, name) => String(values?.[name] ?? ""));
}

function createPage({ search = {}, activities: initial, catalog = {}, clipboard = null } = {}) {
    const scopeHandlers = {};
    const calls = { archived: [], loads: 0, copied: [], pushes: [], cancelled: [] };
    const timers = [];
    let current = { ...search };
    const activities = initial || [
        activity(1, {
            status:       "in_progress",
            currentPhase: { number: 1, mode: "individual" },
            finishedAt:   null,
        }),
        activity(4, { name: "Ética <b>minera</b>", description: "Sección 4" }),
        activity(5, { archived: true }),
    ];
    const listeners = {};
    const notify = () => (listeners.onActivityCatalogUpdated || []).forEach(fn => fn());

    const $scope = {
        $on(name, handler) {
            (scopeHandlers[name] ||= []).push(handler);
        },
        $applyAsync(fn) {
            fn?.();
        },
        navigateTo() {},
    };
    const $rootScope = { $on: () => () => {} };
    const $location = {
        search(key, value) {
            if (key === undefined) {
                return { ...current };
            }
            current = { ...current, [key]: value };
            if (value === null) {
                delete current[key];
            }
            calls.pushes.push({ ...current });
            return { replace() {} };
        },
    };
    const $translate = { use: () => "es_CL", instant: sanitizingInstant };
    const $window = {
        navigator: {
            clipboard: clipboard || {
                writeText: async (text) => {
                    calls.copied.push(text);
                },
            },
        },
    };
    const $timeout = Object.assign((fn, delay) => {
        const timer = { fn, delay };
        timers.push(timer);
        return timer;
    }, {
        cancel(timer) {
            calls.cancelled.push(timer);
        },
    });
    const ActivityCatalogService = {
        getActivities:  () => activities,
        loadActivities: async () => {
            calls.loads += 1;
            notify();
            return activities;
        },
        setArchived: async (sessionId, archived) => {
            calls.archived.push([sessionId, archived]);
            activities.find(item => item.sessionId === sessionId).archived = archived;
            notify();
            return { id: sessionId, archived };
        },
        registerListener(name, fn) {
            (listeners[name] ||= []).push(fn);
        },
        unregisterListener(name, fn) {
            listeners[name] = (listeners[name] || []).filter(item => item !== fn);
        },
        ...catalog,
    };

    const vm = {};
    ActivitiesPageController.call(vm, $scope, $rootScope, $location, $translate, $window,
        ActivityCatalogService, $timeout);

    return {
        vm,
        calls,
        timers,
        activities,
        destroy() {
            (scopeHandlers.$destroy || []).forEach(handler => handler());
        },
    };
}

const rowIds = (vm, tab) => vm.getRows(tab).map(row => row.id);
const rowOf = (vm, id, tab) => vm.getRows(tab).find(row => row.id === id);
const entryOf = (row, id) => row.menu.find(entry => entry.id === id);
const linkOf = (notice, id) => notice.actions.find(action => action.id === id);

function quietly(run) {
    const { error, warn } = console;
    console.error = () => {};
    console.warn = () => {};
    return Promise.resolve(run()).finally(() => {
        console.error = error;
        console.warn = warn;
    });
}

async function archiveFromFinished(page, id = 4) {
    const row = rowOf(page.vm, id, "finished");
    await page.vm.runAction(row, entryOf(row, "archive"));
    return row;
}

describe("activities page, archive notices", () => {
    it("names the archived activity as its row does, with Deshacer, Ver Archivadas", async () => {
        const page = createPage({ search: { tab: "finished" } });
        await page.vm.ready;
        const row = await archiveFromFinished(page);

        assert.deepEqual(page.calls.archived, [[4, true]]);
        assert.equal(page.vm.notice.messageKey, "activities_notice_archived");
        assert.equal(page.vm.notice.tone, "success");
        assert.deepEqual(page.vm.notice.params, { title: row.titleText });
        assert.equal(row.titleText, "Ética <b>minera</b> · Sección 4");
        assert.deepEqual(page.vm.notice.actions.map(action => action.key),
            ["activities_notice_undo", "activities_notice_show_archived"]);
        // The page stays on Terminadas.
        assert.equal(page.vm.tab, "finished");
        assert.deepEqual(page.calls.pushes, []);
        assert.deepEqual(rowIds(page.vm, "archived"), [5, 4]);
    });

    it("puts the title in the message as plain text", async () => {
        const page = createPage({ search: { tab: "finished" } });
        await page.vm.ready;
        await archiveFromFinished(page);
        assert.equal(page.vm.noticeMessage(), "Se archivó \"Ética <b>minera</b> · Sección 4\"");
        // The template binds the message as text, never as HTML.
        assert.match(noticeTemplate, /ng-bind="ap\.noticeMessage\(\)"/u);
        assert.doesNotMatch(noticeTemplate, /ng-bind-html/u);
    });

    it("undoes an archive, and a second Deshacer leaves the activity restored", async () => {
        const page = createPage({ search: { tab: "finished" } });
        await page.vm.ready;
        await archiveFromFinished(page);
        const undo = linkOf(page.vm.notice, "undo-archive");

        await page.vm.runNoticeAction(undo);
        assert.deepEqual(rowIds(page.vm, "finished"), [4]);
        assert.equal(page.vm.notice.messageKey, "activities_notice_restored");
        // Already on Terminadas: no "Ver en Terminadas".
        assert.deepEqual(page.vm.notice.actions, []);

        await page.vm.runNoticeAction(undo);
        assert.deepEqual(page.calls.archived, [[4, true], [4, false], [4, false]]);
        assert.equal(page.activities.find(item => item.sessionId === 4).archived, false);
        assert.deepEqual(rowIds(page.vm, "finished"), [4]);
        assert.deepEqual(rowIds(page.vm, "archived"), [5]);
        assert.equal(page.vm.tab, "finished");
        assert.deepEqual(page.vm.busy, {});
    });

    it("opens Archivadas from the notice", async () => {
        const page = createPage({ search: { tab: "finished" } });
        await page.vm.ready;
        await archiveFromFinished(page);
        await page.vm.runNoticeAction(linkOf(page.vm.notice, "show-archived"));
        assert.equal(page.vm.tab, "archived");
        assert.deepEqual(page.calls.pushes, [{ tab: "archived" }]);
        assert.equal(page.vm.notice, null);
    });

    it("names a restored activity, with Ver en Terminadas, and stays on Archivadas", async () => {
        const page = createPage({ search: { tab: "archived" } });
        await page.vm.ready;
        const row = rowOf(page.vm, 5, "archived");
        await page.vm.runAction(row, row.primary);

        assert.deepEqual(page.calls.archived, [[5, false]]);
        assert.equal(page.vm.noticeMessage(), "Se restauró \"Activity 5 · Section 5\"");
        assert.equal(page.vm.tab, "archived");

        await page.vm.runNoticeAction(linkOf(page.vm.notice, "show-finished"));
        assert.equal(page.vm.tab, "finished");
        assert.deepEqual(rowIds(page.vm, "finished"), [5, 4]);
    });

    it("reloads the activities and says why when the server refuses to archive", async () => {
        await quietly(async () => {
            const page = createPage({
                search:  { tab: "finished" },
                catalog: {
                    setArchived: async () => {
                        throw { status: 409, data: { code: "ACTIVITY_NOT_FINISHED" } };
                    },
                },
            });
            await page.vm.ready;
            const loadsBefore = page.calls.loads;
            await archiveFromFinished(page);
            assert.equal(page.calls.loads, loadsBefore + 1);
            assert.equal(page.vm.notice.messageKey, "activities_notice_archive_not_finished");
            assert.equal(page.vm.notice.tone, "danger");
            assert.equal(page.vm.tab, "finished");
        });
    });

    it("says an archive or a restore failed otherwise, without reloading", async () => {
        await quietly(async () => {
            const page = createPage({
                search:  { tab: "finished" },
                catalog: { setArchived: async () => { throw { status: 500 }; } },
            });
            await page.vm.ready;
            const loadsBefore = page.calls.loads;
            await archiveFromFinished(page);
            assert.equal(page.vm.notice.messageKey, "activities_notice_archive_failed");
            const archived = rowOf(page.vm, 5, "archived");
            await page.vm.runAction(archived, archived.primary);
            assert.equal(page.vm.notice.messageKey, "activities_notice_restore_failed");
            assert.equal(page.calls.loads, loadsBefore);
        });
    });
});

describe("activities page, copy notices", () => {
    it("says Código copiado from the button and from the menu", async () => {
        const page = createPage();
        await page.vm.ready;
        const row = rowOf(page.vm, 1, "ongoing");

        assert.equal(await page.vm.copyCode(row), true);
        assert.equal(page.vm.notice.messageKey, "activities_notice_code_copied");
        page.vm.dismissNotice();

        await page.vm.runAction(row, entryOf(row, "copy-code"));
        assert.equal(page.vm.notice.messageKey, "activities_notice_code_copied");
        assert.deepEqual(page.calls.copied, ["k1", "k1"]);
        assert.equal(page.vm.tab, "ongoing");
    });

    it("says when the browser did not let it copy", async () => {
        await quietly(async () => {
            const page = createPage({
                clipboard: { writeText: async () => { throw new Error("denied"); } },
            });
            await page.vm.ready;
            assert.equal(await page.vm.copyCode(rowOf(page.vm, 1, "ongoing")), false);
            assert.equal(page.vm.notice.messageKey, "activities_notice_copy_failed");
            assert.equal(page.vm.notice.tone, "danger");
        });
    });
});

describe("activities page, notice lifetime", () => {
    it("hides a notice after a few seconds, unless a newer one replaced it", async () => {
        const page = createPage();
        await page.vm.ready;
        const row = rowOf(page.vm, 1, "ongoing");
        await page.vm.copyCode(row);
        const [first] = page.timers;
        assert.equal(first.delay, NOTICE_TIMEOUT_MS);

        await page.vm.copyCode(row);
        assert.deepEqual(page.calls.cancelled, [first]);
        const second = page.vm.notice;
        first.fn();
        assert.equal(page.vm.notice, second);
        page.timers.at(-1).fn();
        assert.equal(page.vm.notice, null);
    });

    it("can be dismissed, and its timer stops with the page", async () => {
        const page = createPage();
        await page.vm.ready;
        await page.vm.copyCode(rowOf(page.vm, 1, "ongoing"));
        page.vm.dismissNotice();
        assert.equal(page.vm.notice, null);
        assert.equal(page.vm.noticeMessage(), "");
        assert.equal(page.calls.cancelled.length, 1);

        await page.vm.copyCode(rowOf(page.vm, 1, "ongoing"));
        page.destroy();
        assert.equal(page.calls.cancelled.length, 2);
    });

    it("keeps the live region in the page and offers a dismiss button", () => {
        assert.match(noticeTemplate,
            /<div class="[^"]*activities-notice-region"[^>]*role="status" aria-live="polite"/u);
        assert.match(noticeTemplate, /ng-click="ap\.dismissNotice\(\)"/u);
        assert.match(noticeTemplate, /'activities_notice_dismiss' \| translate/u);
    });
});
