// The tutor questions of one phase of a running activity that the tutor
// evaluates in the basic mode, with the reason (#865, epic #861), in the
// teacher's activity view. The modes come from GET /activities/:id/tutor-modes
// and are read again whenever the teacher socket announces a new tutor
// session in the phase (`onExternalServiceInstantiated`, relayed by
// ActivityStateService), so a warning appears as soon as a student's first
// answer opens the question's session.

import { announcesTutorSession, basicTutorSessions } from "../helpers/tutor-modes.js";

export const SERVICE_INSTANTIATED_EVENT = "onExternalServiceInstantiated";

// Announcements that arrive together are read once.
const RELOAD_DELAY_MS = 300;

function TutorModeWarningsController($scope, $timeout, TutorModesService, ActivityStateService) {
    const vm = this;
    let destroyed = false;
    let reloadTimer = null;
    let loadSequence = 0;

    vm.warnings = [];

    function onServiceInstantiated(event) {
        if (!announcesTutorSession(event, vm.phaseId)) {
            return;
        }
        if (reloadTimer) {
            $timeout.cancel(reloadTimer);
        }
        reloadTimer = $timeout(() => {
            reloadTimer = null;
            vm.load();
        }, RELOAD_DELAY_MS);
    }

    vm.$onInit = function() {
        ActivityStateService.registerListener(SERVICE_INSTANTIATED_EVENT, onServiceInstantiated);
        return vm.load();
    };

    vm.$onDestroy = function() {
        destroyed = true;
        ActivityStateService.unregisterListener(SERVICE_INSTANTIATED_EVENT, onServiceInstantiated);
        if (reloadTimer) {
            $timeout.cancel(reloadTimer);
            reloadTimer = null;
        }
    };

    vm.load = async function() {
        if (!vm.sessionId || !vm.phaseId) {
            return;
        }

        const sequence = ++loadSequence;
        try {
            const records = await TutorModesService.listTutorModes(vm.sessionId);
            if (destroyed || sequence !== loadSequence) {
                return;
            }
            vm.warnings = basicTutorSessions(records, vm.phaseId);
        } catch (error) {
            // The previous warnings stay; the next announcement reads again.
            console.warn("[tutorModeWarnings] Could not load the tutor modes.", error);
        } finally {
            if (!destroyed && sequence === loadSequence) {
                $scope.$applyAsync();
            }
        }
    };
}

export default {
    bindings: {
        sessionId: "<",
        phaseId:   "<",
    },
    controller: [
        "$scope", "$timeout", "TutorModesService", "ActivityStateService",
        TutorModeWarningsController,
    ],
    templateUrl: "/assets/static/views/teacher/fragments/tutor-mode-warnings.template.html",
};
