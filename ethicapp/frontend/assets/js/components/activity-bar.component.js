// The sticky bar at the top of the teacher's activity dashboard (#893, epic
// #892): the activity's name, status, current phase, access code (with copy)
// and connected students, with the activity controls in its transcluded slot.
// It reads the activity descriptor and the user list the dashboard keeps live
// through ActivityStateService, and works the values out on every digest, so
// a phase transition, a student joining or the end of the activity shows at
// once.

import {
    activityStatus,
    connectedStudentCount,
    currentPhaseSummary,
} from "../helpers/activity-bar.js";

function ActivityBarController() {
    const vm = this;

    vm.statusName = null;
    vm.phaseSummary = null;
    vm.connectedCount = 0;

    vm.$doCheck = function() {
        vm.statusName = activityStatus(vm.activity?.status, vm.isFinished === true);

        const summary = currentPhaseSummary(vm.activity, vm.totalPhases);
        // Keep the same object while nothing changed, so watchers settle.
        if (!sameSummary(summary, vm.phaseSummary)) {
            vm.phaseSummary = summary;
        }

        vm.connectedCount = connectedStudentCount(vm.users);
    };

    // True once the activity and its design are loaded but no phase started.
    vm.isWaitingForFirstPhase = function() {
        return Boolean(vm.activity) && !vm.phaseSummary && vm.statusName !== "finished"
            && Number(vm.totalPhases) > 0;
    };
}

function sameSummary(left, right) {
    if (!left || !right) {
        return left === right;
    }
    return left.number === right.number
        && left.total === right.total
        && left.modeKey === right.modeKey;
}

export default {
    bindings: {
        activity:    "<",
        totalPhases: "<",
        users:       "<",
        isFinished:  "<",
    },
    transclude:  true,
    controller:  [ActivityBarController],
    templateUrl: "/assets/static/views/teacher/fragments/activity-bar.template.html",
};
