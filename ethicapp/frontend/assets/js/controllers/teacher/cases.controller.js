/*eslint func-style: ["error", "expression"]*/
// The case creation and edit forms (`#!/cases/new`, `#!/cases/:id/edit`). The
// list is `CasesPageController` and the view `CaseViewController` (epic #1008).
import {
    caseVideoFieldErrorKeys,
    caseVideoIds,
    caseVideoSaveErrorKey,
    caseVideosFromCase,
} from "../../helpers/case-videos-form.js";
import {
    caseDocumentFieldErrorKeys,
    caseDocumentKeys,
    caseDocumentSaveErrorKey,
    caseDocumentsFromCase,
} from "../../helpers/case-documents-form.js";
import { caseAnalysisSaveErrorKey } from "../../helpers/case-analysis-options.js";
import { caseVisibilityResultMessages } from "../../helpers/case-visibility-result.js";
import { translatePlainText } from "../../helpers/plain-text-translation.js";
import { confirmCasePublication } from "../../helpers/case-publication.js";

export function CasesController($scope, $routeParams, $window, $translate, toast,
    CasesCatalogService, LanguageCatalogService, UserProfileService,
    CasePublicationNoticeService) {
    const vm = this;
    const TOAST_INFO_TIMEOUT_MS = 4 * 1000;
    const TOAST_ERROR_TIMEOUT_MS = 6 * 1000;
    // Long enough to read what changed for the designs that use the case.
    const TOAST_VISIBILITY_TIMEOUT_MS = 12 * 1000;

    vm.caseObj = null;
    vm.licenses = [];
    vm.languages = [];
    vm.currentUserProfile = null;

    vm.translate = function(key) {
        return $translate.instant(key);
    };

    vm.showInfoToast = function(message, timeout = TOAST_INFO_TIMEOUT_MS) {
        toast.create({
            timeout,
            message,
            containerClass: "cases-toast-container",
            dismissible: false,
            defaultToastClass: "toast",
            insertFromTop: true,
        });
    };

    vm.showErrorToast = function(message) {
        toast.create({
            timeout: TOAST_ERROR_TIMEOUT_MS,
            message,
            className: "alert-danger",
            containerClass: "cases-toast-container",
            dismissible: false,
            defaultToastClass: "toast",
            insertFromTop: true,
        });
    };

    // Tells the teacher, in one message, that making the case private also made
    // the public designs that use it private (#934) and, when the save took a
    // public case private, how many designs of other teachers keep it (#939).
    vm.showCaseVisibilityResult = function(result, previousVisibility) {
        const messages = caseVisibilityResultMessages(result, previousVisibility);
        if (messages.length > 0) {
            vm.showInfoToast(
                messages.map(message => translatePlainText($translate, message.key, message.values))
                    .join(" "),
                TOAST_VISIBILITY_TIMEOUT_MS
            );
        }
    };

    // Asks the author to confirm before a case becomes public (#939). Resolves
    // true when the save may go ahead.
    vm.confirmPublication = function(previousVisibility, nextVisibility) {
        return confirmCasePublication(previousVisibility, nextVisibility,
            () => CasePublicationNoticeService.confirm());
    };

    vm.createEmptyCaseForm = function() {
        return {
            title: "",
            authors: [{
                authorFirstname: "",
                authorLastname: "",
                authorEmail: "",
                isPrimary: true,
            }],
            isFirstAuthorCurrentUser: false,
            pdf: null,
            currentPdfPath: null,
            visibility: "private",
            licenseCode: "CC-BY-NC-SA-4.0",
            attributionText: "",
            rightsStatus: "own_work",
            licenseNotes: "",
            permissionStatement: "",
            commercialSource: "",
            languageCode: LanguageCatalogService.getDefaultLanguageCode(vm.languages, "es_CL"),
            tags: [],
            uploadErrorKey: "",

            includesVideos:   false,
            videos:           [],
            initialVideoIds:  [],
            videoFieldErrors: {},

            includesDocuments:   false,
            documents:           [],
            initialDocumentKeys: [],
            documentFieldErrors: {},

            // AI analyses, offered only by the creation form (#650).
            analysisEnabled:   false,
            analysisSelection: {},
        };
    };
    vm.form = vm.createEmptyCaseForm();

    vm.loadCaseFormOptions = async function() {
        const [licenses, languages] = await Promise.all([
            CasesCatalogService.getLicenses(),
            LanguageCatalogService.getLanguages(),
        ]);
        vm.licenses = licenses;
        vm.languages = languages;
        if (!vm.caseObj) {
            vm.form.languageCode = LanguageCatalogService.getDefaultLanguageCode(languages, vm.form.languageCode);
        }
        try {
            vm.currentUserProfile = await UserProfileService.getProfile();
        } catch (error) {
            console.error("[CasesController::loadCaseFormOptions] Could not load user profile.", error);
        }
        $scope.$applyAsync();
    };

    vm.loadCase = async function() {
        const caseId = Number($routeParams.id);
        if (!Number.isInteger(caseId)) {
            return;
        }

        await vm.loadCaseFormOptions();
        const caseObj = await CasesCatalogService.getCaseById(caseId);
        vm.caseObj = caseObj;
        vm.form.title = caseObj.title;
        vm.form.authors = Array.isArray(caseObj.authors) && caseObj.authors.length > 0
            ? caseObj.authors.map((author, index) => ({
                authorFirstname: author.authorFirstname || "",
                authorLastname:  author.authorLastname || "",
                authorEmail:     author.authorEmail || "",
                isPrimary:       index === 0,
            }))
            : [{
                authorFirstname: caseObj.authorFirstname || "",
                authorLastname:  caseObj.authorLastname || "",
                authorEmail:     caseObj.authorEmail || "",
                isPrimary:       true,
            }];
        vm.form.isFirstAuthorCurrentUser = vm.currentUserProfile
            ? vm.form.authors[0]?.authorEmail === (vm.currentUserProfile.email || vm.currentUserProfile.mail)
            : false;
        vm.form.currentPdfPath = caseObj.pdfPath;
        vm.form.visibility = caseObj.visibility || "private";
        vm.form.licenseCode = caseObj.licenseCode || "CC-BY-NC-SA-4.0";
        vm.form.attributionText = caseObj.attributionText || "";
        vm.form.rightsStatus = caseObj.rightsStatus || "own_work";
        vm.form.licenseNotes = caseObj.licenseNotes || "";
        vm.form.permissionStatement = caseObj.permissionStatement || "";
        vm.form.commercialSource = caseObj.commercialSource || "";
        vm.form.languageCode = caseObj.languageCode || "es_CL";
        vm.form.hasLaunchedDesignActivity = caseObj.hasLaunchedDesignActivity === true;
        vm.form.tags = Array.isArray(caseObj.tags) ? caseObj.tags : [];
        vm.form.videos = caseVideosFromCase(caseObj);
        vm.form.initialVideoIds = caseVideoIds(vm.form.videos);
        vm.form.includesVideos = vm.form.videos.length > 0;
        vm.form.videoFieldErrors = {};
        vm.form.documents = caseDocumentsFromCase(caseObj);
        vm.form.initialDocumentKeys = caseDocumentKeys(vm.form.documents);
        vm.form.includesDocuments = vm.form.documents.length > 0;
        vm.form.documentFieldErrors = {};
        $scope.$applyAsync();
    };

    vm.goBack = function() {
        if ($window.history.length > 1) {
            $window.history.back();
            return;
        }

        $scope.navigateTo("/cases");
    };

    vm.handlePdfSelected = function(files) {
        vm.form.pdf = files && files.length > 0 ? files[0] : null;
        vm.form.uploadErrorKey = "";
    };

    vm.getCaseSaveErrorMessageKey = function(error) {
        const videoErrorKey = caseVideoSaveErrorKey(error);
        if (videoErrorKey) {
            return videoErrorKey;
        }
        const documentErrorKey = caseDocumentSaveErrorKey(error);
        if (documentErrorKey) {
            return documentErrorKey;
        }
        const analysisErrorKey = caseAnalysisSaveErrorKey(error);
        if (analysisErrorKey) {
            return analysisErrorKey;
        }

        switch (error?.data?.code) {
        case "CASE_PDF_REQUIRED":
            return "ethical_cases_validation_pdf_required";
        case "INVALID_FILE_TYPE":
        case "UNEXPECTED_FILE_FIELD":
            return "ethical_cases_validation_pdf_type";
        case "FILE_TOO_LARGE":
            return "ethical_cases_validation_pdf_too_large";
        case "CASE_VALIDATION_FAILED":
            return "ethical_cases_validation_required";
        default:
            return "ethical_cases_save_error";
        }
    };

    vm.isCaseUploadError = function(messageKey) {
        return [
            "ethical_cases_validation_pdf_required",
            "ethical_cases_validation_pdf_type",
            "ethical_cases_validation_pdf_too_large",
        ].includes(messageKey);
    };

    // Marks the videos a save refused, next to each one in the list.
    vm.showCaseVideoErrors = function(error) {
        vm.form.videoFieldErrors = caseVideoFieldErrorKeys(error);
    };

    // Marks the attached documents a save refused, next to each one.
    vm.showCaseDocumentErrors = function(error) {
        vm.form.documentFieldErrors = caseDocumentFieldErrorKeys(error);
    };

    vm.createCase = async function() {
        // A new case has no previous visibility. Cancelling keeps the form as
        // it is, public visibility included, and creates nothing.
        if (!(await vm.confirmPublication(null, vm.form.visibility))) {
            return;
        }

        try {
            vm.form.uploadErrorKey = "";
            vm.form.videoFieldErrors = {};
            vm.form.documentFieldErrors = {};
            await CasesCatalogService.createCase(vm.form);
            vm.showInfoToast(vm.translate("ethical_cases_create_success"));
            $scope.navigateTo("/cases");
        } catch (error) {
            console.error("[CasesController::createCase] Error creating case.", error);
            const messageKey = vm.getCaseSaveErrorMessageKey(error);
            if (vm.isCaseUploadError(messageKey)) {
                vm.form.uploadErrorKey = messageKey;
            }
            vm.showCaseVideoErrors(error);
            vm.showCaseDocumentErrors(error);
            vm.showErrorToast(vm.translate(messageKey));
            $scope.$applyAsync();
        }
    };

    vm.updateCase = async function() {
        const caseId = Number($routeParams.id);
        if (!Number.isInteger(caseId)) {
            return;
        }

        // The visibility the case had when it was loaded or last saved.
        const previousVisibility = vm.caseObj?.visibility;
        if (!(await vm.confirmPublication(previousVisibility, vm.form.visibility))) {
            return;
        }

        try {
            vm.form.uploadErrorKey = "";
            vm.form.videoFieldErrors = {};
            vm.form.documentFieldErrors = {};
            const result = await CasesCatalogService.updateCase(caseId, vm.form);
            vm.form.initialVideoIds = caseVideoIds(vm.form.videos);
            vm.form.initialDocumentKeys = caseDocumentKeys(vm.form.documents);
            if (vm.caseObj && result?.visibility) {
                vm.caseObj.visibility = result.visibility;
            }
            vm.showInfoToast(vm.translate("ethical_cases_update_success"));
            vm.showCaseVisibilityResult(result, previousVisibility);
            $scope.$applyAsync();
        } catch (error) {
            console.error("[CasesController::updateCase] Error updating case.", error);
            const messageKey = error?.data?.code === "CASE_USED_BY_LAUNCHED_ACTIVITY"
                ? "case_cannot_delete_used_by_activity"
                : vm.getCaseSaveErrorMessageKey(error);
            if (vm.isCaseUploadError(messageKey)) {
                vm.form.uploadErrorKey = messageKey;
            }
            vm.showCaseVideoErrors(error);
            vm.showCaseDocumentErrors(error);
            vm.showErrorToast(vm.translate(messageKey));
            $scope.$applyAsync();
        }
    };
}
