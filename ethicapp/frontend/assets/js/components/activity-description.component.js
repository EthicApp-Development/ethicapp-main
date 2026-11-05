import { activityCaseOf, activityDesignTitle } from "../helpers/activities-table.js";
import { createActivityDateFormatter, uiLanguageOf } from "../helpers/activity-dates.js";
import { activityTitleParts } from "../helpers/activity-title.js";

// The activity's details in the dashboard's context panel, inside its
// collapsed "Actividad" card: the design used, the case and the launch date.
// The activity bar shows the status and the access code instead (#893). The
// card reads the activity's descriptor (#1055): the design's title
// (`designTitle`), as plain text, and the case (`caseId`, `caseTitle`), unless
// the dashboard passes the case it loaded (`associatedCase`, with its author).
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
        // The case the dashboard loaded is kept as given; the descriptor's
        // own case is rebuilt on every check, and replaced only when it
        // changed.
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

    vm.formatCaseLabel = function(caseItem) {
        if (!caseItem) {
            return "";
        }

        const author = [caseItem.authorFirstname, caseItem.authorLastname]
            .filter(Boolean)
            .join(" ");
        return author ? `${caseItem.title} (${author})` : caseItem.title;
    };
}

const activityDescriptionComponent = {
    bindings: {
        activity:       "<",
        associatedCase: "<?",
    },
    templateUrl: "/assets/static/views/teacher/fragments/activity-description.template.html",
    controller:  ["$rootScope", "$translate", ActivityDescriptionController],
};

export { activityDescriptionComponent };
