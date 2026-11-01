// The phase navigator of the teacher's activity dashboard (#894, epic #892).
// It replaces the phase tabs: one row per phase of the design, with its
// number, mode and "answered / participants", the current phase marked with a
// progress meter. Started phases can be selected; phases that have not
// started are listed but disabled. The rows are worked out on every digest
// from the dashboard's live phase data, so new responses and students show at
// once.
//
// With `layout="pills"` it is the one-column dashboard's row of phase pills
// above the main tabs (#895): the same rows and selection, a pill per phase
// that scrolls sideways when they do not fit, and the selected pill brought
// into view whenever the selection changes, as when the next phase starts.
//
// With `layout="dots"` it is the rail folded into a strip of phase dots,
// while the response detail panel is open between 1200 and 1599 px (#896):
// the same rows and selection, one dot per phase.

import {
    phaseNavigatorRows,
    phasePillMarker,
    sameNavigatorRows,
    scrollLeftToReveal,
} from "../helpers/activity-dashboard.js";

const TEMPLATES = "/assets/static/views/teacher/fragments";

function PhaseNavigatorController($element, $timeout) {
    const vm = this;

    vm.rows = [];
    // The phase whose pill was last brought into view.
    let revealedPhaseId;

    vm.$doCheck = function() {
        const rows = phaseNavigatorRows(vm.designPhases, vm.phases, vm.currentPhaseId);
        // Keep the same rows while nothing changed, so ng-repeat settles.
        if (!sameNavigatorRows(rows, vm.rows)) {
            vm.rows = rows;
        }

        const selected = vm.selectedPhaseId ?? null;
        if (selected !== revealedPhaseId) {
            revealedPhaseId = selected;
            revealSelectedPill();
        }
    };

    vm.isSelected = function(row) {
        return row.started && vm.selectedPhaseId !== null && vm.selectedPhaseId !== undefined
            && Number(row.phaseId) === Number(vm.selectedPhaseId);
    };

    vm.marker = function(row) {
        return phasePillMarker(row);
    };

    vm.select = function(row) {
        if (!row?.started) {
            return;
        }
        vm.onSelect({ phaseId: row.phaseId });
    };

    // Scrolls the row of pills sideways, never the page, once the digest has
    // rendered the selection. The rail's navigator has no pills to scroll.
    function revealSelectedPill() {
        if (!$element?.[0] || typeof $timeout !== "function") {
            return;
        }
        $timeout(() => {
            const list = $element[0].querySelector(".phase-pills-list");
            const pill = list?.querySelector(".phase-pill-selected");
            if (pill) {
                list.scrollLeft = scrollLeftToReveal(list, pill);
            }
        }, 0, false);
    }
}

const LAYOUT_TEMPLATES = Object.freeze({
    pills: "phase-pills.template.html",
    dots:  "phase-dots.template.html",
});

// The template of a layout: the rail's navigator unless `layout` names
// another.
export function phaseNavigatorTemplateUrl(layout) {
    return `${TEMPLATES}/${LAYOUT_TEMPLATES[layout] || "phase-navigator.template.html"}`;
}

export default {
    bindings: {
        designPhases:    "<",
        phases:          "<",
        currentPhaseId:  "<",
        selectedPhaseId: "<",
        onSelect:        "&",
    },
    controller:  ["$element", "$timeout", PhaseNavigatorController],
    templateUrl: ["$attrs", $attrs => phaseNavigatorTemplateUrl($attrs.layout)],
};
