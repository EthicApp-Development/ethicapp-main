// The response detail panel of the teacher's activity dashboard (#896, epic
// #892). A response row opens it next to the table instead of a modal: the
// table stays visible and live, and the panel shows one student's answers or
// one group's answers and chat. The dashboard keeps the selection and hands
// the panel the selected row of its live table.
//
// - ‹ › and the ↑ ↓ keys move to the previous or next row, in the table's
//   order (`on-navigate`); Esc and × close it (`on-close`).
// - The focus moves to the panel's heading whenever it shows a row, and back
//   to the row when it closes.
// - A new row replaces the content: the group component is created again, so
//   it subscribes to the new group's chat and leaves the previous one.
// - In a group phase, a student's panel links to the student's group and its
//   chat (`on-open-group`).
// - A group shows its answers and chat split when the panel is tall enough,
//   as tabs otherwise; the decision follows the window's height.
// - While the dashboard hides names (#897), a student's heading reads
//   "Answer of Member B · Group 2", and the group's chat names its students
//   by pseudonym.

import {
    detailKeyAction,
    detailPanelHeight,
    detailUsesTabs,
    groupMemberRows,
    studentGroupRow,
} from "../helpers/response-detail.js";
import { phaseResponseCounts } from "../helpers/activity-dashboard.js";

// Characters a row key may hold, so it can sit in an attribute selector.
const ROW_KEY_PATTERN = /^[a-z]+:[A-Za-z0-9_-]+$/u;

function ResponseDetailPanelController($scope, $element, $timeout, $window) {
    const $ctrl = this;

    // The selection the content shows, in a one-item list: a new key creates
    // the content component again.
    $ctrl.contents = [];
    $ctrl.useTabs = false;

    let stopWatchingHeight = () => {};

    function updateLayout() {
        $ctrl.useTabs = detailUsesTabs(detailPanelHeight($window?.innerHeight));
    }

    function focusHeading() {
        if (typeof $timeout !== "function") {
            return;
        }
        $timeout(() => {
            $element?.[0]?.querySelector?.(".response-detail-heading")?.focus?.();
        }, 0, false);
    }

    // Moves the focus back to the row the panel showed, once it closed.
    function focusRow(key) {
        if (typeof $timeout !== "function" || !ROW_KEY_PATTERN.test(String(key))) {
            return;
        }
        $timeout(() => {
            $window?.document?.querySelector?.(`[data-detail-key="${key}"]`)?.focus?.();
        }, 0, false);
    }

    $ctrl.$onInit = function() {
        updateLayout();
        if (typeof $window?.addEventListener === "function") {
            const onResize = () => $scope.$applyAsync(updateLayout);
            $window.addEventListener("resize", onResize);
            stopWatchingHeight = () => $window.removeEventListener("resize", onResize);
        }
    };

    $ctrl.$onChanges = function(changes) {
        if (!changes.selection) {
            return;
        }
        const selection = changes.selection.currentValue;
        if (!selection) {
            $ctrl.contents = [];
            return;
        }
        if ($ctrl.contents[0]?.key !== selection.key) {
            $ctrl.contents = [selection];
        }
        // On open, the heading is there once the template is linked.
        if (!changes.selection.isFirstChange()) {
            focusHeading();
        }
    };

    $ctrl.$postLink = function() {
        focusHeading();
    };

    $ctrl.$onDestroy = function() {
        stopWatchingHeight();
    };

    $ctrl.isGroup = function() {
        return $ctrl.selection?.kind === "group";
    };

    $ctrl.close = function() {
        const key = $ctrl.selection?.key;
        $ctrl.onClose();
        focusRow(key);
    };

    $ctrl.navigate = function(step) {
        if ((step < 0 && !$ctrl.hasPrevious) || (step > 0 && !$ctrl.hasNext)) {
            return;
        }
        $ctrl.onNavigate({ step });
    };

    $ctrl.onKeydown = function(event) {
        const action = detailKeyAction(event);
        if (!action) {
            return;
        }
        event.preventDefault();
        if (action === "close") {
            $ctrl.close();
        } else {
            $ctrl.navigate(action === "previous" ? -1 : 1);
        }
    };

    // The group a student's row belongs to, for the link to its chat.
    $ctrl.studentGroup = function() {
        return $ctrl.isGroup() ? null : studentGroupRow($ctrl.phaseData, $ctrl.row);
    };

    $ctrl.openStudentGroup = function() {
        const group = $ctrl.studentGroup();
        if (group) {
            $ctrl.onOpenGroup({ group });
        }
    };

    // How many members the group has and how many answered.
    $ctrl.groupCounts = function() {
        return phaseResponseCounts({ state: groupMemberRows($ctrl.phaseData, $ctrl.selection) });
    };

    $ctrl.isChatPhase = function() {
        return $ctrl.phaseData?.descriptor?.chat === true;
    };

    $ctrl.phaseModeKey = function() {
        return $ctrl.phaseData?.descriptor?.mode === "team"
            ? "activity_bar_phase_mode_team"
            : "activity_bar_phase_mode_individual";
    };
}

export default {
    bindings: {
        // What the panel shows: `{ kind, key, phaseId, … }` (see
        // helpers/response-detail.js).
        selection:      "<",
        // The selected row of the live table: the student's row, or the
        // group's summary row.
        row:            "<",
        // The selected phase, its questions merged with the design's.
        phaseData:      "<",
        canUseLiveChat: "<",
        // Whether the dashboard hides the students' names (#897): `row` and
        // `phase-data` then carry pseudonyms, and a student's heading names
        // the student's group, since a letter only means something in it.
        hideNames:      "<",
        caseVideos:     "<",
        hasPrevious:    "<",
        hasNext:        "<",
        onNavigate:     "&",
        onClose:        "&",
        onOpenGroup:    "&",
    },
    controller:  ["$scope", "$element", "$timeout", "$window", ResponseDetailPanelController],
    templateUrl: "/assets/static/views/teacher/fragments/response-detail-panel.template.html",
};
