import {
    ACTIVITY_TAB_ARCHIVED,
    ACTIVITY_TAB_FINISHED,
    ACTIVITY_TAB_ONGOING,
    ACTIVITY_TABS,
    COLUMN_CODE,
    tableColumns,
} from "../helpers/activities-table.js";

// The table of one tab of Actividades (#1095, epic #1093): "En curso",
// "Terminadas" or "Archivadas", with the rows `buildActivityTables` builds
// (`helpers/activities-table.js`). Each row has its title and case, status,
// participants, the code in "En curso" only, the launch or the end, one
// visible action and a "⋯" menu. Below 1200 px the rows become compact rows.
//
// It reads only its bindings, so the Actividades page and the home can both
// show it. The page around it keeps the filters, the footer, "Mostrar más"
// and the empty alerts.
//
// `rows` must be a stable reference: the same array from one digest to the
// next while the rows do not change, as `ActivitiesPageController.getRows`
// gives. A one-way binding to an expression that builds a new array on each
// call (a `slice`) never settles and raises an infinite digest error. The
// rows shown are cut with `limit` in the template's `limitTo` instead.

// The screen reader caption of each tab's table, when the host gives none.
const CAPTION_KEYS = {
    [ACTIVITY_TAB_ONGOING]:  "activities_tab_ongoing",
    [ACTIVITY_TAB_FINISHED]: "activities_tab_finished",
    [ACTIVITY_TAB_ARCHIVED]: "activities_tab_archived",
};

// "Terminadas" and "Archivadas" share one layout, with the end instead of
// the launch.
const TABLE_LAYOUTS = {
    [ACTIVITY_TAB_ONGOING]:  "ongoing",
    [ACTIVITY_TAB_FINISHED]: "finished",
    [ACTIVITY_TAB_ARCHIVED]: "finished",
};

function tabOf(tab) {
    return ACTIVITY_TABS.includes(tab) ? tab : ACTIVITY_TAB_ONGOING;
}

function ActivitiesTableController() {
    const vm = this;

    vm.$onInit = function() {
        vm.tableTab = tabOf(vm.tab);
        // Built once, so the headers' repeat stays stable.
        vm.columns = tableColumns(vm.tableTab);
        vm.showCode = vm.columns.some(column => column.id === COLUMN_CODE);
        vm.layout = TABLE_LAYOUTS[vm.tableTab];
        // The row's field for the date column: `launched` or `finished`.
        vm.dateField = vm.tableTab === ACTIVITY_TAB_ONGOING ? "launched" : "finished";
        vm.defaultCaption = CAPTION_KEYS[vm.tableTab];
    };

    // An action on the row is pending: its buttons are disabled, so a second
    // click does not repeat it.
    vm.isBusy = function(row) {
        return Boolean(row && vm.busy?.[row.id]);
    };

    vm.runAction = function(row, action) {
        return vm.onAction({ row, action });
    };

    vm.copyCode = function(row) {
        return vm.onCopyCode({ row });
    };
}

const activitiesTableComponent = {
    bindings: {
        tab:        "@",
        rows:       "<",
        limit:      "<?",
        busy:       "<",
        caption:    "@?",
        onAction:   "&",
        onCopyCode: "&",
    },
    templateUrl: "/assets/static/views/teacher/fragments/activities-table.template.html",
    controller:  ActivitiesTableController,
};

export { activitiesTableComponent };
