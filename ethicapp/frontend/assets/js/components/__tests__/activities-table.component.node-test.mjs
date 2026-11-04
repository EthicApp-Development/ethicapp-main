// The activities-table component (#1095, epic #1093): the En curso,
// Terminadas and Archivadas tables of Actividades, from their bindings only,
// so the home can show them too.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { activitiesTableComponent } from "../activities-table.component.js";

const FRAGMENTS = new URL("../../../static/views/teacher/fragments/", import.meta.url);
const read = name => readFileSync(new URL(name, FRAGMENTS), "utf8");
const template = read("activities-table.template.html");
const rowMenu = read("activities-row-menu.template.html");

function createTable(bindings = {}) {
    const calls = { actions: [], copies: [] };
    const vm = new activitiesTableComponent.controller();
    Object.assign(vm, {
        rows:       [],
        busy:       {},
        onAction:   locals => calls.actions.push(locals),
        onCopyCode: locals => calls.copies.push(locals),
        ...bindings,
    });
    vm.$onInit();
    return { vm, calls };
}

const columnIds = vm => vm.columns.map(column => column.id);

describe("activities table, bindings", () => {
    it("binds the shared contract", () => {
        assert.deepEqual(activitiesTableComponent.bindings, {
            tab:        "@",
            rows:       "<",
            limit:      "<?",
            busy:       "<",
            caption:    "@?",
            onAction:   "&",
            onCopyCode: "&",
        });
        assert.equal(activitiesTableComponent.templateUrl,
            "/assets/static/views/teacher/fragments/activities-table.template.html");
    });
});

describe("activities table, columns", () => {
    it("gives each tab its columns", () => {
        assert.deepEqual(columnIds(createTable({ tab: "ongoing" }).vm),
            ["activity", "status", "participants", "code", "launched"]);
        assert.deepEqual(columnIds(createTable({ tab: "finished" }).vm),
            ["activity", "status", "participants", "finished"]);
        assert.deepEqual(columnIds(createTable({ tab: "archived" }).vm),
            ["activity", "status", "participants", "finished"]);
    });

    it("shows the code column in En curso only", () => {
        assert.equal(createTable({ tab: "ongoing" }).vm.showCode, true);
        assert.equal(createTable({ tab: "finished" }).vm.showCode, false);
        assert.equal(createTable({ tab: "archived" }).vm.showCode, false);
        assert.ok(template.includes(
            '<td class="cases-cell activities-cell-code" ng-if="$ctrl.showCode">'));
    });

    it("dates En curso by the launch and the others by the end", () => {
        assert.equal(createTable({ tab: "ongoing" }).vm.dateField, "launched");
        assert.equal(createTable({ tab: "finished" }).vm.dateField, "finished");
        assert.equal(createTable({ tab: "archived" }).vm.dateField, "finished");
        assert.match(template, /row\[\$ctrl\.dateField\]\.label/);
        assert.match(template, /row\[\$ctrl\.dateField\]\.hint/);
    });

    it("shares one layout between Terminadas and Archivadas", () => {
        assert.equal(createTable({ tab: "ongoing" }).vm.layout, "ongoing");
        assert.equal(createTable({ tab: "finished" }).vm.layout, "finished");
        assert.equal(createTable({ tab: "archived" }).vm.layout, "finished");
        assert.ok(template.includes("'activities-table-ongoing': $ctrl.layout === 'ongoing'"));
        assert.ok(template.includes("'activities-table-finished': $ctrl.layout === 'finished'"));
    });

    it("reads an unknown tab as En curso", () => {
        const { vm } = createTable({ tab: "other" });
        assert.equal(vm.tableTab, "ongoing");
        assert.ok(vm.showCode);
    });
});

describe("activities table, caption", () => {
    it("defaults the caption from the tab", () => {
        assert.equal(createTable({ tab: "ongoing" }).vm.defaultCaption, "activities_tab_ongoing");
        assert.equal(createTable({ tab: "finished" }).vm.defaultCaption, "activities_tab_finished");
        assert.equal(createTable({ tab: "archived" }).vm.defaultCaption, "activities_tab_archived");
    });

    it("prefers the host's caption", () => {
        assert.ok(template.includes(
            "{{ ($ctrl.caption || $ctrl.defaultCaption) | translate }}</caption>"));
    });
});

describe("activities table, rows", () => {
    // A one-way binding to a new array on every digest never settles, so
    // the rows are cut in the repeat instead.
    it("shows the first `limit` rows of the bound rows", () => {
        assert.match(template,
            /ng-repeat="row in \$ctrl\.rows \| limitTo:\$ctrl\.limit track by row\.id"/);
        assert.doesNotMatch(template, /getVisibleRows/);
    });

    it("keeps the row's session id and the actions' ids", () => {
        assert.ok(template.includes('data-session-id="{{ row.id }}"'));
        assert.ok(template.includes('data-action="{{ row.primary.id }}"'));
        assert.ok(rowMenu.includes('data-action="{{ entry.id }}"'));
        assert.ok(template.includes("fragments/activities-row-menu.template.html"));
    });

    it("reads only its bindings, never the page's alias", () => {
        for (const [name, source] of [["table", template], ["row menu", rowMenu]]) {
            assert.doesNotMatch(source, /\bap\./, name);
        }
    });
});

describe("activities table, actions", () => {
    const row = { id: 12, primary: { id: "open-dashboard" } };

    it("tells which rows are busy", () => {
        const { vm } = createTable({ tab: "ongoing", busy: { 12: true } });
        assert.equal(vm.isBusy(row), true);
        assert.equal(vm.isBusy({ id: 13 }), false);
        vm.busy = {};
        assert.equal(vm.isBusy(row), false, "follows the bound map");
        vm.busy = undefined;
        assert.equal(vm.isBusy(row), false);
    });

    it("disables the row's buttons while it is busy", () => {
        assert.ok(template.includes('ng-disabled="$ctrl.isBusy(row)"'));
        assert.ok(rowMenu.includes('ng-disabled="$ctrl.isBusy(row)"'));
    });

    it("hands the row and the action to the host", () => {
        const { vm, calls } = createTable({ tab: "ongoing" });
        const entry = { id: "archive" };
        vm.runAction(row, row.primary);
        vm.runAction(row, entry);
        assert.deepEqual(calls.actions, [{ row, action: row.primary }, { row, action: entry }]);
        assert.equal(calls.actions[1].row, row);
        assert.ok(template.includes('ng-click="$ctrl.runAction(row, row.primary)"'));
        assert.ok(rowMenu.includes('ng-click="$ctrl.runAction(row, entry)"'));
    });

    it("hands the row to the host to copy its code", () => {
        const { vm, calls } = createTable({ tab: "ongoing" });
        vm.copyCode(row);
        assert.deepEqual(calls.copies, [{ row }]);
        assert.ok(template.includes('ng-click="$ctrl.copyCode(row)"'));
    });
});
