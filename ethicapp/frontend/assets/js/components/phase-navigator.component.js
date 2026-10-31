// The phase navigator in the rail of the teacher's activity dashboard (#894,
// epic #892). It replaces the phase tabs: one row per phase of the design,
// with its number, mode and "answered / participants", the current phase
// marked with a progress meter. Started phases can be selected; phases that
// have not started are listed but disabled. The rows are worked out on every
// digest from the dashboard's live phase data, so new responses and students
// show at once.

import { phaseNavigatorRows, sameNavigatorRows } from "../helpers/activity-dashboard.js";

function PhaseNavigatorController() {
    const vm = this;

    vm.rows = [];

    vm.$doCheck = function() {
        const rows = phaseNavigatorRows(vm.designPhases, vm.phases, vm.currentPhaseId);
        // Keep the same rows while nothing changed, so ng-repeat settles.
        if (!sameNavigatorRows(rows, vm.rows)) {
            vm.rows = rows;
        }
    };

    vm.isSelected = function(row) {
        return row.started && vm.selectedPhaseId !== null && vm.selectedPhaseId !== undefined
            && Number(row.phaseId) === Number(vm.selectedPhaseId);
    };

    vm.select = function(row) {
        if (!row?.started) {
            return;
        }
        vm.onSelect({ phaseId: row.phaseId });
    };
}

export default {
    bindings: {
        designPhases:    "<",
        phases:          "<",
        currentPhaseId:  "<",
        selectedPhaseId: "<",
        onSelect:        "&",
    },
    controller:  [PhaseNavigatorController],
    templateUrl: "/assets/static/views/teacher/fragments/phase-navigator.template.html",
};
