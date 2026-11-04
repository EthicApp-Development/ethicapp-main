import * as StatusCode from "../../../../common/modules/session-status.js";
import { activityCaseOf, activityDesignTitle } from "../helpers/activities-table.js";
import { createActivityDateFormatter, uiLanguageOf } from "../helpers/activity-dates.js";
import { activityTitleParts } from "../helpers/activity-title.js";

// The activity card of the home's recent activities and the dashboard's
// context panel. It reads the activity's own fields, as GET /activities and
// the activity's descriptor give them (#1055): the design's id and title
// (`designId`, `designTitle`) and the case (`caseId`, `caseTitle`), unless the
// dashboard passes the case it loaded (`associatedCase`, with its author).
// Designs are not told apart by type (#964), so the card does not name one.
// The launch date is in the browser's time zone and the UI language, and
// follows a change of language.

// When the activity was launched, as a label ("hoy, 18:01", "12 oct, 09:05")
// and the full date for its hover title; "—" without a valid date.
function launchDateOf(activity, dates) {
    return {
        label: dates.label(activity?.time, { withTime: true }) || { text: "—" },
        full:  dates.full(activity?.time),
    };
}

function sameCase(left, right) {
    return left === right
        || (Boolean(left) && Boolean(right) && left.id === right.id && left.title === right.title);
}

function ActivityDescriptionController($rootScope, $translate) {
    const vm = this;
    let dates = null;
    let launchedFrom;

    function formatter() {
        if (!dates) {
            dates = createActivityDateFormatter({ uiLanguage: uiLanguageOf($translate) });
        }
        return dates;
    }

    // The heading's `name` and `description` (#973), "" when missing.
    vm.title = activityTitleParts(vm.activity);
    vm.designTitle = "";
    vm.caseItem = null;
    vm.launchDate = null;

    // Everything the card shows from the activity, again only for what
    // changed, so watchers settle.
    function update() {
        const title = activityTitleParts(vm.activity);
        if (title.name !== vm.title.name || title.description !== vm.title.description) {
            vm.title = title;
        }
        vm.designTitle = activityDesignTitle(vm.activity);
        // The case the dashboard loaded is kept as given; the row's own case
        // is rebuilt on every check, and replaced only when it changed.
        const caseItem = vm.associatedCase || activityCaseOf(vm.activity);
        if (vm.associatedCase ? caseItem !== vm.caseItem : !sameCase(caseItem, vm.caseItem)) {
            vm.caseItem = caseItem;
        }
        const time = vm.activity?.time;
        if (vm.launchDate === null || time !== launchedFrom) {
            launchedFrom = time;
            vm.launchDate = launchDateOf(vm.activity, formatter());
        }
    }

    let stopFollowingLanguage = null;

    vm.$onInit = function() {
        if (vm.enableLink === undefined) {
            vm.enableLink = true;
        }
        if (vm.showStatusAndCode === undefined) {
            vm.showStatusAndCode = true;
        }
        // The run block switches to the profile's language after the profile
        // loads, often after the card is shown: the date follows it.
        // angular-translate emits the event on $rootScope.
        stopFollowingLanguage = $rootScope?.$on?.("$translateChangeSuccess", () => {
            dates = null;
            vm.launchDate = launchDateOf(vm.activity, formatter());
        }) || null;
    };

    vm.$doCheck = update;

    vm.$onDestroy = function() {
        stopFollowingLanguage?.();
        stopFollowingLanguage = null;
    };

    vm.getReadableStatus = function(value) {
        // Convert name to code if needed
        const code = isNaN(value) ? StatusCode.getStatusCode(value) : value;
        return StatusCode.getNameByCode(code);
    };

    vm.formatCaseLabel = function(caseItem) {
        if (!caseItem) {
            return "";
        }

        const author = [caseItem.authorFirstname, caseItem.authorLastname]
            .filter(Boolean)
            .join(" ");
        return author ? `${caseItem.title} (${author})` : caseItem.title;
    };

    vm.isFunction = function(variable) {
        return typeof variable === "function";
    };
}

const activityDescriptionComponent = {
    // `showStatusAndCode` is false where the dashboard's activity bar shows
    // them instead (#893).
    bindings: {
        activity:          "<",
        associatedCase:    "<?",
        enableLink:        "<",
        onView:            "<?",
        showStatusAndCode: "<?",
    },
    templateUrl: "/assets/static/views/teacher/fragments/activity-description.template.html",
    controller:  ["$rootScope", "$translate", ActivityDescriptionController],
};

export { activityDescriptionComponent };
