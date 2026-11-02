// The "Launch an activity" wizard (#971, epic #965): its shell and step 1,
// choosing a design. It owns the wizard's state (step, search, selection and
// description) for both routes, `#!/activities/new` and
// `#!/activities/new/:designId`, which preselects that design.
//
// The step is mirrored in the URL (`?step=2`), so the browser's Back and
// Forward move between steps; the routes do not reload on a search change, so
// returning to step 1 keeps the search, the selection and the scroll position.
// Step 2 is still today's description and launch form (ActivityController)
// until the wizard's own step 2 lands (#972).

import {
    LAUNCH_LIST_PAGE_SIZE,
    buildLaunchList,
    describeDesignPhases,
    formatLaunchDate,
    isLaunchableDesign,
    launchSummary,
    phaseCountKey,
} from "../../helpers/launch-design-list.js";
import { serviceDisplayName } from "../../helpers/service-configuration-summary.js";

export const CHOOSE_STEP = 1;
export const LAUNCH_STEP = 2;

function stepFromSearch(search) {
    return Number(search?.step) === LAUNCH_STEP ? LAUNCH_STEP : CHOOSE_STEP;
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

    let designs = [];
    let activities = [];
    let stats = new Map();
    let serviceListing = null;
    let serviceListingRequested = false;
    // Whether step 2 was reached from step 1 in this page, so leaving it can
    // go back in the history instead of adding an entry.
    let cameFromChooseStep = false;
    let chooseStepScrollY = 0;

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
            id:             design.id,
            title:          design.metainfo?.title || "",
            phaseCount:     phases.length,
            phaseCountKey:  phaseCountKey(phases.length),
            usesAiServices: design.usesAiServices === true,
            associatedCase: design.associatedCase || null,
            phases,
            createdDate:    formatDate(design.createdAt),
            launch:         entry?.count > 0 ? launchSummary(design, stats, formatDate) : null,
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

    // Step 2 opens at the top, with the description field focused.
    function openLaunchStep() {
        $timeout(() => {
            $window.scrollTo(0, 0);
            $window.document.getElementById("activity-description-input")
                ?.focus?.({ preventScroll: true });
        }, 0, false);
    }

    function showStep(step) {
        if (step === vm.step) {
            return;
        }
        if (step === LAUNCH_STEP && !vm.hasSelection()) {
            // Step 2 needs a design: a reload of `?step=2` without one starts over.
            $location.search("step", null).replace();
            return;
        }

        if (vm.step === CHOOSE_STEP) {
            chooseStepScrollY = $window.scrollY || 0;
        }
        vm.step = step;
        if (step === CHOOSE_STEP) {
            $timeout(() => $window.scrollTo(0, chooseStepScrollY), 0, false);
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
        $location.search("step", null).replace();
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
            return;
        }

        vm.selectedDesignId = designId;
        const index = vm.rows.findIndex(row => row.id === designId);
        if (index >= vm.visibleCount) {
            const pages = Math.ceil((index + 1) / LAUNCH_LIST_PAGE_SIZE);
            vm.visibleCount = pages * LAUNCH_LIST_PAGE_SIZE;
        }
        $timeout(() => {
            $window.document.getElementById(`launch-design-${designId}`)
                ?.scrollIntoView?.({ block: "nearest" });
        }, 0, false);
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
        showStep(stepFromSearch($location.search()));
        $scope.$applyAsync();
    };

    vm.$onRouteUpdate = function() {
        if (vm.loaded) {
            showStep(stepFromSearch($location.search()));
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
