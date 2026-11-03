// The "AI analysis" section of the case creation form (#650, epic #647). It
// lists the case-scoped services the current AI service policy allows and
// renders nothing when there are none, or when they cannot be loaded. It
// edits `formModel.analysisEnabled` and `formModel.analysisSelection`, which
// the cases service sends as the case's `analysisServiceIds` field.
//
// The case view's "Add analysis" dialog (#1039) uses it with `mode="add"`:
// without the switch, which stays on, and without the services the case has
// already chosen (`excludedServiceIds`). `onServicesLoaded({ services })`
// tells its host which services it offers once they are loaded.
import {
    CASE_ANALYSIS_OPTIONS_MODE_ADD,
    CASE_ANALYSIS_SCOPE,
    caseAnalysisServiceDescription,
    caseAnalysisServiceLabel,
    caseAnalysisServiceUsesLlm,
    caseAnalysisServicesToAdd,
    hasMissingCaseAnalysisSelection,
    pruneCaseAnalysisSelection,
} from "../helpers/case-analysis-options.js";

const CaseAnalysisOptionsController = function($scope, ExternalServicesCatalogService,
    LanguageCatalogService) {
    const vm = this;

    vm.$onInit = function() {
        vm.services = [];
        if (vm.isAddMode() && vm.formModel) {
            vm.formModel.analysisEnabled = true;
        }
        vm.loadServices();
    };

    vm.isAddMode = function() {
        return vm.mode === CASE_ANALYSIS_OPTIONS_MODE_ADD;
    };

    vm.loadServices = async function() {
        try {
            // Always asked again: the operator may have changed the policy.
            const services = await ExternalServicesCatalogService.getServices({
                scopes: [CASE_ANALYSIS_SCOPE],
                reload: true,
            });
            vm.services = caseAnalysisServicesToAdd(services, vm.excludedServiceIds);
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
        vm.onServicesLoaded?.({ services: vm.services });
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

    // Without the switch, the error cannot suggest turning it off.
    vm.selectionErrorKey = function() {
        return vm.isAddMode()
            ? "case_analysis_add_select_tool"
            : "case_analysis_validation_select_tool";
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
        // "add" for the case view's "Add analysis" dialog (#1039).
        mode:               "@?",
        excludedServiceIds: "<?",
        onServicesLoaded:   "&?",
    },
    controller: [
        "$scope", "ExternalServicesCatalogService", "LanguageCatalogService",
        CaseAnalysisOptionsController,
    ],
    templateUrl: "/assets/static/views/teacher/fragments/case-analysis-options.template.html",
};

export default caseAnalysisOptionsComponent;
