// The "Launch an activity" wizard (#971, epic #965): its shell and step 1,
// choosing a design. It owns the wizard's state (step, search, selection and
// description) for both routes, `#!/activities/new` and
// `#!/activities/new/:designId`, which preselects that design and opens on
// step 2 (the design view's "Launch activity"). Step 2, identifying and
// launching the activity, is the `launch-activity-step` component (#972).
//
// The step is mirrored in the URL (`?step=2`; `?step=1` on the design's
// route, whose default is step 2), so the browser's Back and Forward move
// between steps; the routes do not reload on a search change, so returning to
// step 1 keeps the search, the selection and the scroll position.

import {
    LAUNCH_LIST_PAGE_SIZE,
    buildLaunchList,
    describeDesignPhases,
    formatLaunchDate,
    isLaunchableDesign,
    launchSummary,
    phaseCountKey,
} from "../../helpers/launch-design-list.js";
import { plannedDesignDuration, plannedDurationListText } from "../../helpers/phase-duration.js";
import { serviceDisplayName } from "../../helpers/service-configuration-summary.js";

export const CHOOSE_STEP = 1;
export const LAUNCH_STEP = 2;

// The step the URL asks for: `?step=` when it names one, else step 2 on the
// design's route and step 1 on the plain one.
export function stepFromSearch(search, hasRouteDesign = false) {
    const step = Number(search?.step);
    if (step === LAUNCH_STEP || step === CHOOSE_STEP) {
        return step;
    }
    return hasRouteDesign ? LAUNCH_STEP : CHOOSE_STEP;
}

export function LaunchActivityWizardController($scope, $rootScope, $routeParams, $location,
    $timeout, $window, DesignCatalogService, ActivityCatalogService,
    ExternalServicesCatalogService, LanguageCatalogService) {

    const vm = this;

    vm.step = CHOOSE_STEP;
    vm.loaded = false;
    vm.loadFailed = false;
    vm.search = "";
    vm.selectedDesignId = null;
    vm.description = "";
    vm.visibleCount = LAUNCH_LIST_PAGE_SIZE;

    vm.total = 0;
    vm.designsWithErrors = 0;
    vm.rows = [];
    vm.selectedRow = null;
    vm.preview = null;
    // The route named a design that cannot be launched.
    vm.routeDesignUnavailable = false;

    let designs = [];
    let activities = [];
    let stats = new Map();
    let serviceListing = null;
    let serviceListingRequested = false;
    // Whether step 2 was reached from step 1 in this page, so leaving it can
    // go back in the history instead of adding an entry.
    let cameFromChooseStep = false;
    let chooseStepScrollY = 0;
    // Whether step 1 has been shown: opened on step 2 from the design view,
    // step 1 first shows with the selected row in view.
    let chooseStepShown = false;
    const hasRouteDesign = $routeParams.designId !== undefined;

    function uiLanguage() {
        return LanguageCatalogService.getCurrentUiLanguageCode();
    }

    function formatDate(value) {
        return formatLaunchDate(value, uiLanguage());
    }

    function findDesign(id) {
        return designs.find(design => design.id === id) || null;
    }

    function serviceName(serviceId) {
        const listed = serviceListing?.find(service => service.id === serviceId) ?? null;
        return serviceDisplayName(listed, uiLanguage());
    }

    // Service names come from each service's own UI texts (GET
    // /external-services), as in the design view and the dashboard. They are
    // asked for once, when a design with AI services is first previewed.
    async function loadServiceNames() {
        if (serviceListingRequested) {
            return;
        }
        serviceListingRequested = true;
        try {
            serviceListing = await ExternalServicesCatalogService.getServices({ scopes: [] });
        } catch (error) {
            console.warn("[LaunchActivityWizardController] Service listing unavailable.", error);
            serviceListing = null;
        }
        vm.refreshPreview();
        $scope.$applyAsync();
    }

    vm.refreshList = function() {
        const list = buildLaunchList(designs, activities, { query: vm.search, formatDate });
        stats = list.stats;
        vm.total = list.total;
        vm.designsWithErrors = list.designsWithErrors;
        vm.rows = list.rows;
        vm.refreshPreview();
    };

    vm.refreshPreview = function() {
        const design = findDesign(vm.selectedDesignId);
        if (!design) {
            vm.selectedRow = null;
            vm.preview = null;
            return;
        }

        const phases = describeDesignPhases(design, serviceName);
        if (phases.some(phase => phase.services.length > 0)) {
            loadServiceNames();
        }
        const entry = stats.get(design.id);
        vm.selectedRow = { id: design.id, title: design.metainfo?.title || "" };
        vm.preview = {
            id:                  design.id,
            title:               design.metainfo?.title || "",
            phaseCount:          phases.length,
            phaseCountKey:       phaseCountKey(phases.length),
            usesAiServices:      design.usesAiServices === true,
            associatedCase:      design.associatedCase || null,
            phases,
            // The phases with a duration and their total, for step 2's time
            // mode (#1109).
            plannedDuration:     plannedDesignDuration(design.phases),
            // The same total as a chip next to the number of phases, or null.
            plannedDurationText: plannedDurationListText(design.phases),
            createdDate:         formatDate(design.createdAt),
            launch:              entry?.count > 0 ? launchSummary(design, stats, formatDate) : null,
        };
    };

    vm.getVisibleRows = function() {
        return vm.rows.slice(0, vm.visibleCount);
    };

    vm.hasMoreRows = function() {
        return vm.rows.length > vm.visibleCount;
    };

    vm.showMore = function() {
        vm.visibleCount += LAUNCH_LIST_PAGE_SIZE;
    };

    vm.handleSearchChange = function() {
        vm.visibleCount = LAUNCH_LIST_PAGE_SIZE;
        vm.refreshList();
    };

    vm.isSearching = function() {
        return String(vm.search || "").trim().length > 0;
    };

    vm.selectDesign = function(designId) {
        vm.selectedDesignId = designId;
        vm.refreshPreview();
    };

    vm.hasSelection = function() {
        return vm.selectedRow !== null;
    };

    // Double-clicking a row selects it and moves on.
    vm.chooseAndContinue = function(designId) {
        vm.selectDesign(designId);
        vm.goToLaunchStep();
    };

    // `?step=` for step 1: none on the plain route, `1` on the design's.
    function chooseStepParam() {
        return hasRouteDesign ? CHOOSE_STEP : null;
    }

    function scrollSelectedRowIntoView() {
        $timeout(() => {
            $window.document.getElementById(`launch-design-${vm.selectedDesignId}`)
                ?.scrollIntoView?.({ block: "nearest" });
        }, 0, false);
    }

    // Step 1 shows where the teacher left it; the first time, with the
    // selected row in view.
    function openChooseStep() {
        if (chooseStepShown) {
            $timeout(() => $window.scrollTo(0, chooseStepScrollY), 0, false);
        } else if (vm.hasSelection()) {
            scrollSelectedRowIntoView();
        }
        chooseStepShown = true;
    }

    // Step 2 opens at the top; the step focuses its description field.
    function openLaunchStep() {
        $timeout(() => $window.scrollTo(0, 0), 0, false);
    }

    function showStep(step) {
        if (step === vm.step) {
            if (step === CHOOSE_STEP && !chooseStepShown) {
                openChooseStep();
            }
            return;
        }
        if (step === LAUNCH_STEP && !vm.hasSelection()) {
            // Step 2 needs a design: a reload of `?step=2` without one, or the
            // route of a design that cannot be launched, starts over.
            $location.search("step", chooseStepParam()).replace();
            showStep(CHOOSE_STEP);
            return;
        }

        if (vm.step === CHOOSE_STEP && chooseStepShown) {
            chooseStepScrollY = $window.scrollY || 0;
        }
        vm.step = step;
        if (step === CHOOSE_STEP) {
            openChooseStep();
        } else {
            openLaunchStep();
        }
    }

    vm.goToLaunchStep = function() {
        if (!vm.hasSelection()) {
            return;
        }
        cameFromChooseStep = true;
        $location.search("step", LAUNCH_STEP);
        showStep(LAUNCH_STEP);
    };

    vm.goToChooseStep = function() {
        if (cameFromChooseStep) {
            // The URL's history already holds step 1 just before this one.
            cameFromChooseStep = false;
            $window.history.back();
            return;
        }
        if (hasRouteDesign) {
            // Opened on step 2 from the design view: step 1 is a new entry,
            // so Back returns to step 2.
            $location.search("step", CHOOSE_STEP);
        } else {
            $location.search("step", null).replace();
        }
        showStep(CHOOSE_STEP);
    };

    // "Cancel" goes where today's "Back" went: the previous page, else home.
    vm.cancel = function() {
        if ($window.history.length > 1) {
            $window.history.back();
            return;
        }
        $scope.navigateTo("/");
    };

    function preselectFromRoute() {
        const designId = Number($routeParams.designId);
        const design = Number.isInteger(designId) ? findDesign(designId) : null;
        if (!isLaunchableDesign(design)) {
            vm.routeDesignUnavailable = hasRouteDesign && !vm.loadFailed;
            return;
        }

        vm.selectedDesignId = designId;
        const index = vm.rows.findIndex(row => row.id === designId);
        if (index >= vm.visibleCount) {
            const pages = Math.ceil((index + 1) / LAUNCH_LIST_PAGE_SIZE);
            vm.visibleCount = pages * LAUNCH_LIST_PAGE_SIZE;
        }
    }

    vm.load = async function() {
        try {
            [designs, activities] = await Promise.all([
                DesignCatalogService.getDesigns(true),
                ActivityCatalogService.loadActivities(),
            ]);
        } catch (error) {
            console.error("[LaunchActivityWizardController] Could not load designs.", error);
            vm.loadFailed = true;
        }

        vm.refreshList();
        preselectFromRoute();
        vm.refreshPreview();
        vm.loaded = true;
        showStep(stepFromSearch($location.search(), hasRouteDesign));
        $scope.$applyAsync();
    };

    vm.$onRouteUpdate = function() {
        if (vm.loaded) {
            showStep(stepFromSearch($location.search(), hasRouteDesign));
        }
    };

    vm.init = function() {
        // The routes do not reload on a search change (`?step=`), so Back and
        // Forward reach the page as a route update.
        $scope.$on("$routeUpdate", vm.$onRouteUpdate);
        // Leaving the wizard, for instance for the dashboard after a launch,
        // does not carry `?step=` to the next page.
        $scope.$on("$routeChangeStart", () => {
            if ($location.search().step !== undefined) {
                $location.search("step", null).replace();
            }
        });

        const stopListening = $rootScope.$on("$translateChangeEnd", () => {
            vm.refreshList();
            $scope.$applyAsync();
        });
        $scope.$on("$destroy", stopListening);

        return vm.load();
    };

    vm.ready = vm.init();
}
