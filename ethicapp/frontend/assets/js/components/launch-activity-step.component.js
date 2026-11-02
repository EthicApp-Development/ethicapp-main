// The launch wizard's second step (#972, epic #965): identify the activity
// and launch it. It names the chosen design, asks for the required
// description (with the teacher's previous ones as chips), checks which of
// the design's AI services can run and lets the teacher turn them off for
// this activity, previews the activity card, and launches from its action
// bar, where errors are shown too.
//
// The wizard (LaunchActivityWizardController) owns the selection and the
// description, so going back to step 1 and returning keeps them:
// - `designId`, the chosen design;
// - `preview`, the wizard's preview of it (title, phases, case);
// - `description`, bound both ways;
// - `onBack()`, "Change design" and "Back".
//
// The launch keeps today's flow: GET /designs/:id/valid, POST /sessions,
// POST /activities (with `aiServices: false` when turned off, #970), the
// design locked locally, then the activity's dashboard.

import {
    isActivityDescriptionValid,
    normalizeActivityDescription,
} from "../../../../common/modules/activity-description.js";
import { activityTitleParts } from "../helpers/activity-title.js";
import {
    AI_SERVICES_STATE,
    launchAiServicesFlag,
    launchAiServicesView,
} from "../helpers/launch-ai-services.js";
import { previousDescriptions } from "../helpers/launch-previous-descriptions.js";
import { serviceDisplayName } from "../helpers/service-configuration-summary.js";

export const DESCRIPTION_INPUT_ID = "activity-description-input";

/**
 * The translation key of the action bar's message for a failed launch.
 * `error` is what the launch rejected with: an HTTP error (`status`), or a
 * LaunchActivityError from ActivityCatalogService.createActivity (`stage`,
 * `status`, `code`).
 */
export function launchErrorKey(error) {
    if (error?.code === "ACTIVITY_DESCRIPTION_REQUIRED") {
        return "launch_wizard_error_description_required";
    }
    if (error?.status === 404) {
        return "launch_wizard_error_design_unavailable";
    }
    if (error?.stage === "session" && error.status === 403) {
        return "launch_wizard_error_not_allowed";
    }
    return "launch_wizard_error_failed";
}

function LaunchActivityStepController($scope, $rootScope, $timeout, $window,
    DesignCatalogService, ActivityCatalogService, ExternalServicesCatalogService,
    LanguageCatalogService) {

    const vm = this;
    const states = AI_SERVICES_STATE;

    let services = [];
    let serviceListing = null;
    let checking = true;
    let checkFailed = false;
    let checkSequence = 0;
    let launched = false;
    let stopListening = null;

    vm.states = states;
    vm.descriptionInputId = DESCRIPTION_INPUT_ID;
    vm.aiServicesEnabled = true;
    vm.aiServices = launchAiServicesView({ loading: true });
    vm.previousDescriptions = [];
    vm.launching = false;
    vm.error = null;

    function serviceName(serviceId) {
        const listed = serviceListing?.find(service => service.id === serviceId) ?? null;
        return serviceDisplayName(listed, LanguageCatalogService.getCurrentUiLanguageCode());
    }

    vm.refreshAiServices = function() {
        vm.aiServices = launchAiServicesView({
            services,
            loading: checking,
            failed:  checkFailed,
            enabled: vm.aiServicesEnabled,
            serviceName,
        });
    };

    async function loadServiceNames() {
        try {
            serviceListing = await ExternalServicesCatalogService.getServices({ scopes: [] });
        } catch (error) {
            console.warn("[launchActivityStep] Service listing unavailable.", error);
            serviceListing = null;
        }
    }

    // Which of the design's services can run (GET /designs/:id/ai-services),
    // with their names from GET /external-services.
    vm.checkAiServices = async function() {
        const sequence = ++checkSequence;
        checking = true;
        checkFailed = false;
        vm.refreshAiServices();

        let checked = [];
        let failure = null;
        await Promise.all([
            DesignCatalogService.getDesignAiServices(vm.designId)
                .then(result => {
                    checked = result;
                }, error => {
                    failure = error;
                }),
            loadServiceNames(),
        ]);
        if (sequence !== checkSequence) {
            return;
        }

        checking = false;
        if (failure) {
            console.warn("[launchActivityStep] Could not check the design's AI services.", failure);
            checkFailed = true;
            services = [];
            if (failure?.status === 404) {
                vm.error = "launch_wizard_error_design_unavailable";
            }
        } else {
            services = checked;
        }
        vm.refreshAiServices();
        $scope.$applyAsync();
    };

    vm.hasDescription = function() {
        return isActivityDescriptionValid(vm.description);
    };

    vm.useDescription = function(text) {
        vm.description = text;
        vm.error = null;
    };

    vm.isCurrentDescription = function(text) {
        return normalizeActivityDescription(vm.description) === text;
    };

    // The activity card as Activities and the dashboard show it (#973).
    vm.cardTitle = function() {
        return activityTitleParts({ name: vm.preview?.title, description: vm.description });
    };

    vm.canLaunch = function() {
        return !vm.launching
            && vm.hasDescription()
            && vm.aiServices.state !== states.LOADING;
    };

    vm.launch = async function() {
        if (!vm.canLaunch()) {
            return;
        }

        vm.launching = true;
        vm.error = null;
        try {
            if (!await DesignCatalogService.isDesignValid(vm.designId)) {
                vm.error = "faulty_design";
                return;
            }

            const design = await DesignCatalogService.getDesignById(vm.designId);
            if (!design) {
                vm.error = "launch_wizard_error_design_unavailable";
                return;
            }

            const sessionId = await ActivityCatalogService.createActivity(
                design,
                normalizeActivityDescription(vm.description),
                { aiServices: launchAiServicesFlag(vm.aiServices) });

            // The server locked the design; the catalog follows. Its local
            // lock toggles, so a design already locked is left as it is.
            if (design.locked !== true) {
                await DesignCatalogService.lockDesign(vm.designId, true);
            }

            launched = true;
            $rootScope.navigateTo(`/activities/${sessionId}`);
        } catch (error) {
            console.error("[launchActivityStep] Could not launch the activity.", error);
            vm.error = launchErrorKey(error);
        } finally {
            // After a launch the button keeps "Preparing the dashboard…"
            // until the dashboard opens.
            if (!launched) {
                vm.launching = false;
            }
            $scope.$applyAsync();
        }
    };

    vm.back = function() {
        if (!vm.launching) {
            vm.onBack();
        }
    };

    vm.$onInit = function() {
        vm.previousDescriptions = previousDescriptions(ActivityCatalogService.getActivities());
        // Service names follow the UI language.
        stopListening = $rootScope.$on("$translateChangeEnd", async () => {
            await loadServiceNames();
            vm.refreshAiServices();
            $scope.$applyAsync();
        });
        vm.ready = vm.checkAiServices();
    };

    // The step opens with the description field focused.
    vm.$postLink = function() {
        $timeout(() => {
            $window.document.getElementById(DESCRIPTION_INPUT_ID)
                ?.focus?.({ preventScroll: true });
        }, 0, false);
    };

    vm.$onDestroy = function() {
        checkSequence += 1;
        stopListening?.();
    };
}

const launchActivityStepComponent = {
    bindings: {
        designId:    "<",
        preview:     "<",
        description: "=",
        onBack:      "&",
    },
    templateUrl: "/assets/static/views/teacher/fragments/launch-activity-step.template.html",
    controller:  [
        "$scope", "$rootScope", "$timeout", "$window",
        "DesignCatalogService", "ActivityCatalogService", "ExternalServicesCatalogService",
        "LanguageCatalogService",
        LaunchActivityStepController,
    ],
};

export default launchActivityStepComponent;
