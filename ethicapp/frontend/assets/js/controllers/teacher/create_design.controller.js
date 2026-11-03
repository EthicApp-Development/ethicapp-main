import { designFactories } from  "../../../../../common/modules/design-types.js";
import {
    designSaveErrorMessageKey,
    isCaseNotAvailableError,
} from "../../helpers/design-save-errors.js";
import {
    NEW_DESIGN_CASE_NOT_AVAILABLE,
    NEW_DESIGN_CASE_PARAM,
    newDesignCaseLoadErrorKey,
    newDesignCaseRefusalKey,
    requestedCaseFromSearch,
} from "../../helpers/new-design-from-case.js";

/*eslint func-style: ["error", "expression"]*/
export function CreateDesignController($scope, $window,
    DesignCatalogService, UserInformationService, LanguageCatalogService,
    $location, CasesCatalogService) {
    const vm = this;
    vm.selectedOption = "semantic_differential";
    vm.associatedCase = null;
    vm.tags = [];
    vm.languages = [];
    vm.languageCode = "en_US";
    // True while the case of the URL (`?caseId=`, #1019) is being loaded.
    vm.caseLoading = false;
    // Set once the teacher picks or removes a case, so a preselection that
    // arrives later does not replace their choice.
    let caseChosenByTeacher = false;

    const loadLanguages = async function() {
        vm.languages = await LanguageCatalogService.getLanguages();
        vm.languageCode = LanguageCatalogService.getDefaultLanguageCode(vm.languages, vm.languageCode);
        $scope.$applyAsync();
    };

    // "New design with this case" (#1019): `#!/designs/new?caseId=<id>`
    // preselects the case when the teacher may associate it: their own case
    // that is not archived, or another teacher's public case. Otherwise no
    // case is selected, and the message under the selector says why.
    const preselectCase = async function({ requested, caseId }) {
        if (!requested) {
            return;
        }
        if (caseId === null) {
            vm.caseErrorKey = NEW_DESIGN_CASE_NOT_AVAILABLE;
            return;
        }

        vm.caseLoading = true;
        let caseItem = null;
        let errorKey = null;
        try {
            const [loadedCase, profile] = await Promise.all([
                CasesCatalogService.getCaseById(caseId),
                UserInformationService.getUserInformation(),
            ]);
            errorKey = newDesignCaseRefusalKey(loadedCase, profile?.id);
            caseItem = errorKey === null ? loadedCase : null;
        } catch (error) {
            console.warn("[CreateDesignController] Could not load the case to preselect.", error);
            errorKey = newDesignCaseLoadErrorKey(error);
        }

        $scope.$applyAsync(() => {
            vm.caseLoading = false;
            if (caseChosenByTeacher) {
                return;
            }
            vm.associatedCase = caseItem;
            vm.caseErrorKey = errorKey;
        });
    };

    // The case of the URL is read once, then its parameter is removed,
    // replacing the history entry (the route does not reload on a search
    // change). So the parameter does not follow the form's links, which keep
    // the search, and Back still returns to the page the teacher came from.
    const takeRequestedCase = function() {
        const search = $location.search();
        const requestedCase = requestedCaseFromSearch(search);
        if (search[NEW_DESIGN_CASE_PARAM] !== undefined) {
            $location.search(NEW_DESIGN_CASE_PARAM, null).replace();
        }
        return requestedCase;
    };

    vm.init = async function() {
        const requestedCase = takeRequestedCase();
        await Promise.all([loadLanguages(), preselectCase(requestedCase)]);
    };

    vm.goBack = function() {
        if ($window.history.length > 1) {
            $window.history.back();
            return;
        }

        $scope.navigateTo("/designs");
    };

    vm.selectCase = function(caseItem) {
        caseChosenByTeacher = true;
        vm.associatedCase = caseItem || null;
        vm.caseErrorKey = null;
    };

    vm.clearAssociatedCase = function() {
        caseChosenByTeacher = true;
        vm.associatedCase = null;
    };

    // Translation key of the message shown under the case selector when the
    // selected case can no longer be associated (#924), or when the case of
    // the URL was not preselected (#1019), or null.
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

    vm.ready = vm.init();
};
