import { designFactories } from  "../../../../../common/modules/design-types.js";
import {
    designSaveErrorMessageKey,
    isCaseNotAvailableError,
} from "../../helpers/design-save-errors.js";

/*eslint func-style: ["error", "expression"]*/
export function CreateDesignController($scope, $window,
    DesignCatalogService, UserInformationService, LanguageCatalogService) {
    const vm = this;
    vm.selectedOption = "semantic_differential";
    vm.associatedCase = null;
    vm.tags = [];
    vm.languages = [];
    vm.languageCode = "en_US";

    vm.init = async function() {
        vm.languages = await LanguageCatalogService.getLanguages();
        vm.languageCode = LanguageCatalogService.getDefaultLanguageCode(vm.languages, vm.languageCode);
        $scope.$applyAsync();
    };

    vm.goBack = function() {
        if ($window.history.length > 1) {
            $window.history.back();
            return;
        }

        $scope.navigateTo("/designs");
    };

    vm.selectCase = function(caseItem) {
        vm.associatedCase = caseItem || null;
        vm.caseErrorKey = null;
    };

    vm.clearAssociatedCase = function() {
        vm.associatedCase = null;
    };

    // Translation key of the message shown under the case selector when the
    // selected case can no longer be associated (#924), or null.
    vm.caseErrorKey = null;

    vm.uploadDesign = async function (title, type) {
        vm.caseErrorKey = null;
        try {
            const factory = designFactories[type];
            if (!factory) {
                throw Error("Unsupported design type!");
            }
            
            const userInformation = await UserInformationService.getUserInformation();
            const design = factory(title, userInformation.name);
            
            design.metainfo.institution = userInformation.institution_name || "";
            design.metainfo.email = userInformation.email;
            design.caseId = vm.associatedCase?.id || null;
            design.tags = vm.tags;
            design.languageCode = vm.languageCode;

            const designId = await DesignCatalogService.createDesign(design);

            if (!designId) {
                throw Error("Could not create the new design.");
            }

            // Switch to the editor view
            $scope.navigateTo(`/designs/${designId}/edit`);
        } catch (error) {
            // The case can no longer be associated (#924): explain it and
            // clear the case, so the teacher can pick another case or create
            // the design without one.
            if (isCaseNotAvailableError(error)) {
                $scope.$applyAsync(() => {
                    vm.clearAssociatedCase();
                    vm.caseErrorKey = designSaveErrorMessageKey(error);
                });
            }
            // Log and handle any errors encountered during the HTTP request or response processing
            console.error("Error uploading design:", error.message || error);
        }
    };

    vm.init();
};
