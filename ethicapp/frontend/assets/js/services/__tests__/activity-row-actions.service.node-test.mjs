// The row actions of an activity and their notices (#1094, epic #1093),
// shared by the Activities page and the home: each action leaves for its page,
// copies the code or archives through the catalog; the notices name the row's
// title as plain text, offer their links by the tab on screen, stay for a few
// seconds and can be dismissed. AngularJS services are fakes; the rows are
// built by `helpers/activities-table.js`, as the pages build them.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ActivityRowActionsService } from "../activity-row-actions.service.js";
import { buildActivityTables } from "../../helpers/activities-table.js";
import { createActivityDateFormatter } from "../../helpers/activity-dates.js";
import { NOTICE_TIMEOUT_MS } from "../../helpers/activity-action-feedback.js";

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
        designTitle:      `Activity ${sessionId}`,
        caseId:           7,
        caseTitle:        "Case",
        currentPhase:     null,
        phaseCount:       2,
        participantCount: 3,
        finishedAt:       "2026-10-20T12:00:00Z",
        ...fields,
    };
}

function makeActivities() {
    return [
        activity(1, {
            status:       "in_progress",
            currentPhase: { number: 1, mode: "individual" },
            finishedAt:   null,
        }),
        activity(4, { name: "Ética <b>minera</b>", description: "Sección 4" }),
        activity(5, { archived: true }),
    ];
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

function fakeScope() {
    const handlers = {};
    return {
        $on(name, handler) {
            (handlers[name] ||= []).push(handler);
        },
        $applyAsync(fn) {
            fn?.();
        },
        destroy() {
            (handlers.$destroy || []).forEach(handler => handler());
        },
    };
}

/**
 * The service with fakes, and the rows of the activities in the catalog,
 * built again whenever the catalog notifies a change.
 */
function createService({ catalog = {}, clipboard = null, onTimeout = null } = {}) {
    const calls = {
        navigated: [], locations: [], archived: [], loads: 0, copied: [], cancelled: [],
    };
    const timers = [];
    const activities = makeActivities();
    const dates = createActivityDateFormatter({ uiLanguage: "es_CL" });
    let tables = buildActivityTables(activities, dates);
    const notify = () => {
        tables = buildActivityTables(activities, dates);
    };

    const $rootScope = {
        $applyAsync(fn) {
            fn?.();
        },
        navigateTo(path) {
            calls.navigated.push(path);
        },
    };
    const $location = {
        path(path) {
            return {
                search(search) {
                    calls.locations.push({ path, search });
                },
            };
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
    let service = null;
    const $timeout = Object.assign((fn, delay) => {
        const timer = { fn, delay };
        timers.push(timer);
        onTimeout?.(service);
        return timer;
    }, {
        cancel(timer) {
            calls.cancelled.push(timer);
        },
    });
    const ActivityCatalogService = {
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
        ...catalog,
    };

    const factory = ActivityRowActionsService($rootScope, $location, $translate, $window,
        $timeout, ActivityCatalogService);

    return {
        calls,
        timers,
        activities,
        rowIds: tab => tables[tab].map(row => row.id),
        rowOf:  (id, tab) => tables[tab].find(row => row.id === id),
        // One instance, as a controller creates it.
        create(options) {
            const scope = fakeScope();
            service = factory.create(scope, options);
            return Object.assign(service, { scope });
        },
    };
}

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

// Archivar from a row of Terminadas.
async function archive(fixture, actions, id = 4) {
    const row = fixture.rowOf(id, "finished");
    await actions.run(row, entryOf(row, "archive"));
    return row;
}

describe("activity row actions, actions", () => {
    it("opens the dashboard, the reports, the design, the case and the wizard", async () => {
        const fixture = createService();
        const actions = fixture.create();
        const ongoing = fixture.rowOf(1, "ongoing");
        await actions.run(ongoing, ongoing.primary);
        await actions.run(ongoing, entryOf(ongoing, "reports"));
        await actions.run(ongoing, entryOf(ongoing, "view-design"));
        await actions.run(ongoing, entryOf(ongoing, "view-case"));
        const finished = fixture.rowOf(4, "finished");
        await actions.run(finished, finished.primary);
        await actions.run(finished, entryOf(finished, "launch-again"));
        assert.deepEqual(fixture.calls.navigated, [
            "/activities/1", "/activities/1/reports", "/designs/41", "/cases/7",
            "/activities/4/reports", "/activities/new/44",
        ]);
        assert.deepEqual(actions.busy, {});
    });

    it("ignores a missing, disabled or unknown entry and a second click while busy", async () => {
        const fixture = createService();
        const actions = fixture.create();
        const row = fixture.rowOf(1, "ongoing");
        await actions.run(row, null);
        await actions.run(null, row.primary);
        await actions.run(row, { ...entryOf(row, "view-case"), disabled: true });
        await actions.run(row, { id: "unknown" });
        await actions.run(row, { id: "constructor" });
        actions.busy[row.id] = true;
        await actions.run(row, row.primary);
        assert.deepEqual(fixture.calls.navigated, []);
    });

    it("keeps the row busy while its action runs", async () => {
        let release;
        let requests = 0;
        const fixture = createService({
            catalog: {
                setArchived: () => new Promise(resolve => {
                    requests += 1;
                    release = resolve;
                }),
            },
        });
        const actions = fixture.create();
        const row = fixture.rowOf(4, "finished");
        const pending = actions.run(row, entryOf(row, "archive"));
        assert.deepEqual(actions.busy, { 4: true });
        await actions.run(row, entryOf(row, "archive"));
        release();
        await pending;
        assert.equal(requests, 1);
        assert.deepEqual(actions.busy, {});
    });

    it("archives a finished activity and restores an archived one", async () => {
        const fixture = createService();
        const actions = fixture.create();
        await archive(fixture, actions);
        assert.deepEqual(fixture.rowIds("archived"), [5, 4]);
        const archived = fixture.rowOf(5, "archived");
        await actions.run(archived, archived.primary);
        assert.deepEqual(fixture.calls.archived, [[4, true], [5, false]]);
        assert.deepEqual(fixture.rowIds("finished"), [5]);
    });
});

describe("activity row actions, archive notices", () => {
    it("names the archived activity as its row does, with Deshacer, Ver Archivadas", async () => {
        const fixture = createService();
        const actions = fixture.create({ currentTab: () => "finished" });
        const row = await archive(fixture, actions);

        assert.deepEqual(fixture.calls.archived, [[4, true]]);
        assert.equal(actions.notice.messageKey, "activities_notice_archived");
        assert.equal(actions.notice.tone, "success");
        assert.deepEqual(actions.notice.params, { title: row.titleText });
        assert.equal(row.titleText, "Ética <b>minera</b> · Sección 4");
        assert.deepEqual(actions.notice.actions.map(action => action.key),
            ["activities_notice_undo", "activities_notice_show_archived"]);
        // Nothing leaves the page.
        assert.deepEqual(fixture.calls.navigated, []);
        assert.deepEqual(fixture.calls.locations, []);
    });

    it("puts the title in the message as plain text", async () => {
        const fixture = createService();
        const actions = fixture.create();
        assert.equal(actions.noticeMessage(), "");
        await archive(fixture, actions);
        assert.equal(actions.noticeMessage(), "Se archivó \"Ética <b>minera</b> · Sección 4\"");
    });

    it("leaves Ver Archivadas out on Archivadas, and Ver en Terminadas on Terminadas", async () => {
        const fixture = createService();
        let tab = "archived";
        const actions = fixture.create({ currentTab: () => tab });
        await archive(fixture, actions);
        assert.deepEqual(actions.notice.actions.map(action => action.id), ["undo-archive"]);

        const archived = fixture.rowOf(5, "archived");
        await actions.run(archived, archived.primary);
        assert.deepEqual(actions.notice.actions.map(action => action.id), ["show-finished"]);

        tab = "finished";
        const again = fixture.rowOf(4, "archived");
        await actions.run(again, again.primary);
        assert.deepEqual(actions.notice.actions, []);
    });

    it("opens the Activities page on Archivadas by default", async () => {
        const fixture = createService();
        const actions = fixture.create({ currentTab: () => "finished" });
        await archive(fixture, actions);
        await actions.runNoticeAction(linkOf(actions.notice, "show-archived"));
        // `#!/activities?tab=archived`, with no other search.
        assert.deepEqual(fixture.calls.locations,
            [{ path: "/activities", search: { tab: "archived" } }]);
        assert.equal(actions.notice, null);
    });

    it("opens the Activities page on Terminadas by default", async () => {
        const fixture = createService();
        const actions = fixture.create();
        const archived = fixture.rowOf(5, "archived");
        await actions.run(archived, archived.primary);
        await actions.runNoticeAction(linkOf(actions.notice, "show-finished"));
        assert.deepEqual(fixture.calls.locations,
            [{ path: "/activities", search: { tab: "finished" } }]);
    });

    it("opens a tab with the page's own showTab", async () => {
        const fixture = createService();
        const shown = [];
        const actions = fixture.create({ showTab: tab => shown.push(tab) });
        await archive(fixture, actions);
        await actions.runNoticeAction(linkOf(actions.notice, "show-archived"));
        assert.deepEqual(shown, ["archived"]);
        assert.deepEqual(fixture.calls.locations, []);
    });

    it("undoes an archive with a restore notice, and a second Deshacer leaves it restored",
        async () => {
            const fixture = createService();
            const actions = fixture.create({ currentTab: () => "finished" });
            await archive(fixture, actions);
            const undo = linkOf(actions.notice, "undo-archive");

            await actions.runNoticeAction(undo);
            assert.deepEqual(fixture.rowIds("finished"), [4]);
            assert.equal(actions.notice.messageKey, "activities_notice_restored");
            assert.equal(actions.noticeMessage(),
                "Se restauró \"Ética <b>minera</b> · Sección 4\"");
            // Already on Terminadas: no "Ver en Terminadas".
            assert.deepEqual(actions.notice.actions, []);

            await actions.runNoticeAction(undo);
            assert.deepEqual(fixture.calls.archived, [[4, true], [4, false], [4, false]]);
            assert.equal(fixture.activities.find(item => item.sessionId === 4).archived, false);
            assert.deepEqual(fixture.rowIds("archived"), [5]);
            assert.deepEqual(actions.busy, {});
        });

    it("shows the notice before the row stops being busy, and drops Deshacer meanwhile",
        async () => {
            const busyWhenShown = [];
            const fixture = createService({
                onTimeout: service => busyWhenShown.push({ ...service.busy }),
            });
            const actions = fixture.create({ currentTab: () => "finished" });
            await archive(fixture, actions);
            assert.deepEqual(busyWhenShown, [{ 4: true }]);
            assert.deepEqual(actions.busy, {});

            // "Deshacer" while the row is still busy does nothing but close
            // the notice.
            const undo = linkOf(actions.notice, "undo-archive");
            actions.busy[4] = true;
            await actions.runNoticeAction(undo);
            assert.deepEqual(fixture.calls.archived, [[4, true]]);
            assert.equal(actions.notice, null);
            assert.deepEqual(fixture.rowIds("archived"), [5, 4]);
        });

    it("reloads the activities and says why when the server refuses to archive", async () => {
        await quietly(async () => {
            const fixture = createService({
                catalog: {
                    setArchived: async () => {
                        throw { status: 409, data: { code: "ACTIVITY_NOT_FINISHED" } };
                    },
                },
            });
            const actions = fixture.create();
            await archive(fixture, actions);
            assert.equal(fixture.calls.loads, 1);
            assert.equal(actions.notice.messageKey, "activities_notice_archive_not_finished");
            assert.equal(actions.notice.tone, "danger");
            assert.deepEqual(actions.busy, {});
        });
    });

    it("says an archive or a restore failed otherwise, without reloading", async () => {
        await quietly(async () => {
            const fixture = createService({
                catalog: { setArchived: async () => { throw { status: 500 }; } },
            });
            const actions = fixture.create();
            await archive(fixture, actions);
            assert.equal(actions.notice.messageKey, "activities_notice_archive_failed");
            const archived = fixture.rowOf(5, "archived");
            await actions.run(archived, archived.primary);
            assert.equal(actions.notice.messageKey, "activities_notice_restore_failed");
            assert.equal(fixture.calls.loads, 0);
        });
    });
});

describe("activity row actions, copy notices", () => {
    it("says Código copiado from the button and from the menu", async () => {
        const fixture = createService();
        const actions = fixture.create();
        const row = fixture.rowOf(1, "ongoing");

        assert.equal(await actions.copyCode(row), true);
        assert.equal(actions.notice.messageKey, "activities_notice_code_copied");
        actions.dismissNotice();

        await actions.run(row, entryOf(row, "copy-code"));
        assert.equal(actions.notice.messageKey, "activities_notice_code_copied");
        assert.deepEqual(fixture.calls.copied, ["k1", "k1"]);
    });

    it("answers false, and says so, when the browser did not let it copy", async () => {
        await quietly(async () => {
            const fixture = createService({
                clipboard: { writeText: async () => { throw new Error("denied"); } },
            });
            const actions = fixture.create();
            assert.equal(await actions.copyCode(fixture.rowOf(1, "ongoing")), false);
            assert.equal(actions.notice.messageKey, "activities_notice_copy_failed");
            assert.equal(actions.notice.tone, "danger");
        });
    });

    it("answers false for a row without a code, with no notice", async () => {
        const fixture = createService();
        const actions = fixture.create();
        assert.equal(await actions.copyCode({ code: "" }), false);
        assert.equal(await actions.copyCode(null), false);
        assert.equal(actions.notice, null);
        assert.deepEqual(fixture.calls.copied, []);
    });
});

describe("activity row actions, notice lifetime", () => {
    it("hides a notice after a few seconds, unless a newer one replaced it", async () => {
        const fixture = createService();
        const actions = fixture.create();
        const row = fixture.rowOf(1, "ongoing");
        await actions.copyCode(row);
        const [first] = fixture.timers;
        assert.equal(first.delay, NOTICE_TIMEOUT_MS);

        await actions.copyCode(row);
        assert.deepEqual(fixture.calls.cancelled, [first]);
        const second = actions.notice;
        first.fn();
        assert.equal(actions.notice, second);
        fixture.timers.at(-1).fn();
        assert.equal(actions.notice, null);
    });

    it("can be dismissed, and its timer stops when the scope is destroyed", async () => {
        const fixture = createService();
        const actions = fixture.create();
        await actions.copyCode(fixture.rowOf(1, "ongoing"));
        actions.dismissNotice();
        assert.equal(actions.notice, null);
        assert.equal(actions.noticeMessage(), "");
        assert.equal(fixture.calls.cancelled.length, 1);

        await actions.copyCode(fixture.rowOf(1, "ongoing"));
        actions.scope.destroy();
        assert.deepEqual(fixture.calls.cancelled, fixture.timers);
        assert.equal(fixture.timers.length, 2);
    });

    it("keeps each instance's busy rows and notice apart", async () => {
        const fixture = createService();
        const page = fixture.create({ currentTab: () => "finished" });
        const home = fixture.create();
        assert.notEqual(page.busy, home.busy);

        home.busy[4] = true;
        await archive(fixture, page);
        assert.equal(page.notice.messageKey, "activities_notice_archived");
        assert.equal(home.notice, null);
        assert.deepEqual(page.busy, {});
        assert.deepEqual(home.busy, { 4: true });

        // Destroying one scope stops only its own timer.
        await home.copyCode(fixture.rowOf(1, "ongoing"));
        const homeTimer = fixture.timers.at(-1);
        home.scope.destroy();
        assert.deepEqual(fixture.calls.cancelled, [homeTimer]);
        assert.equal(page.notice.messageKey, "activities_notice_archived");
    });
});
