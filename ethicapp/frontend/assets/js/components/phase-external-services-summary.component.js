// Read-only list of a phase's external services and their settings, for the
// design and activity views (#757). Names and labels come in the UI language
// (#745); when a service cannot provide them, the stored settings are shown as
// they are. Phases without services render nothing.

import {
    phaseEnabledServiceIds,
    phaseServiceConfiguration,
    serviceDisplayName,
    storedSettingRows,
    summarizeServiceSettings,
} from "../helpers/service-configuration-summary.js";

function PhaseExternalServicesSummaryController($scope, $rootScope, ExternalServicesCatalogService,
    LanguageCatalogService) {
    const vm = this;

    vm.hasServices = false;
    vm.loading = false;
    vm.services = [];

    let loadSequence = 0;
    let stopListening = null;

    async function describeService(serviceId, listing, language) {
        const configuration = phaseServiceConfiguration(vm.phase, serviceId);
        const listed = listing?.find(service => service.id === serviceId) ?? null;
        const base = {
            id:         serviceId,
            name:       serviceDisplayName(listed, serviceId, language),
            usesLlm:    listed?.descriptor?.usesLlm === true,
            storedRows: storedSettingRows(configuration),
        };

        if (!listing) {
            return { ...base, status: "unavailable" };
        }
        if (!listed) {
            // Unknown, or disabled in this installation (#738).
            return { ...base, status: "not_available" };
        }
        if (!listed.descriptor) {
            return { ...base, status: "no_settings" };
        }

        try {
            const result = await ExternalServicesCatalogService
                .getInstanceConfiguration(serviceId, { reuse: true });
            if (!result?.available) {
                return { ...base, status: "unavailable" };
            }

            const summary = summarizeServiceSettings(result.fields || [], configuration);
            const name = listed.ui?.translations?.[language]?.label || result.name || base.name;
            return {
                ...base,
                name,
                usesLlm:       result.usesLlm === true,
                status:        "ready",
                stale:         result.stale === true,
                rows:          summary.rows,
                retiredFields: storedSettingRows(Object.fromEntries(summary.retiredFields
                    .map(({ key, value }) => [key, value]))),
            };
        } catch (error) {
            return { ...base, status: error?.status === 404 ? "no_settings" : "unavailable" };
        }
    }

    vm.load = async function() {
        const sequence = ++loadSequence;
        const serviceIds = phaseEnabledServiceIds(vm.phase);
        vm.hasServices = serviceIds.length > 0;
        if (!vm.hasServices) {
            vm.services = [];
            return;
        }

        vm.loading = true;
        const language = LanguageCatalogService.getCurrentUiLanguageCode();
        let listing = null;
        try {
            listing = await ExternalServicesCatalogService.getServices({ scopes: [] });
        } catch (error) {
            console.warn("[PhaseExternalServicesSummary] Service listing unavailable.", error);
        }

        const services = await Promise.all(serviceIds
            .map(serviceId => describeService(serviceId, listing, language)));
        if (sequence !== loadSequence) {
            return;
        }

        vm.services = services;
        vm.loading = false;
        $scope.$applyAsync();
    };

    vm.$onInit = function() {
        stopListening = $rootScope.$on("$translateChangeEnd", () => vm.load());
        vm.load();
    };

    vm.$onChanges = function(changes) {
        if (changes.phase && !changes.phase.isFirstChange()) {
            vm.load();
        }
    };

    vm.$onDestroy = function() {
        stopListening?.();
        loadSequence += 1;
    };
}

const phaseExternalServicesSummaryComponent = {
    bindings: {
        phase: "<",
    },
    controller: [
        "$scope",
        "$rootScope",
        "ExternalServicesCatalogService",
        "LanguageCatalogService",
        PhaseExternalServicesSummaryController,
    ],
    templateUrl:
        "/assets/static/views/teacher/fragments/phase-external-services-summary.template.html",
};

export default phaseExternalServicesSummaryComponent;
