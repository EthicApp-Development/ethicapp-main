// The "AI analysis" section of the case creation form (#650, epic #647). It
// lists the case-scoped services the current AI service policy allows and
// renders nothing when there are none, or when they cannot be loaded. It
// edits `formModel.analysisEnabled` and `formModel.analysisSelection`, which
// the cases service sends as the case's `analysisServiceIds` field.
import {
    CASE_ANALYSIS_SCOPE,
    caseAnalysisServiceDescription,
    caseAnalysisServiceLabel,
    caseAnalysisServiceUsesLlm,
    hasMissingCaseAnalysisSelection,
    pruneCaseAnalysisSelection,
} from "../helpers/case-analysis-options.js";

const CaseAnalysisOptionsController = function($scope, ExternalServicesCatalogService,
    LanguageCatalogService) {
    const vm = this;

    vm.$onInit = function() {
        vm.services = [];
        vm.loadServices();
    };

    vm.loadServices = async function() {
        try {
            // Always asked again: the operator may have changed the policy.
            const services = await ExternalServicesCatalogService.getServices({
                scopes: [CASE_ANALYSIS_SCOPE],
                reload: true,
            });
            vm.services = Array.isArray(services) ? services : [];
        } catch (error) {
            console.error("[caseAnalysisOptions] Could not load the analysis services.", error);
            vm.services = [];
        }

        if (vm.formModel) {
            vm.formModel.analysisSelection = pruneCaseAnalysisSelection(
                vm.formModel.analysisSelection,
                vm.services
            );
            if (vm.services.length === 0) {
                vm.formModel.analysisEnabled = false;
            }
        }
        $scope.$applyAsync();
    };

    vm.hasServices = function() {
        return vm.services.length > 0;
    };

    vm.isEnabled = function() {
        return vm.formModel?.analysisEnabled === true;
    };

    vm.shouldShowSelectionError = function() {
        return vm.hasAttemptedSubmit === true && hasMissingCaseAnalysisSelection(vm.formModel);
    };

    vm.getServiceControlId = function(service) {
        return `caseAnalysisService-${service.id}`;
    };

    function currentLanguage() {
        return LanguageCatalogService.getCurrentUiLanguageCode();
    }

    vm.serviceLabel = function(service) {
        return caseAnalysisServiceLabel(service, currentLanguage());
    };

    vm.serviceDescription = function(service) {
        return caseAnalysisServiceDescription(service, currentLanguage());
    };

    vm.serviceUsesLlm = caseAnalysisServiceUsesLlm;
};

const caseAnalysisOptionsComponent = {
    bindings: {
        formModel:          "=",
        hasAttemptedSubmit: "<",
    },
    controller: [
        "$scope", "ExternalServicesCatalogService", "LanguageCatalogService",
        CaseAnalysisOptionsController,
    ],
    templateUrl: "/assets/static/views/teacher/fragments/case-analysis-options.template.html",
};

export default caseAnalysisOptionsComponent;
