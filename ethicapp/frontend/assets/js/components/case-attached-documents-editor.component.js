// The "Attached documents" section of the case form (#793, epic #789):
// public Google Docs, Sheets, Slides and Drive files, added by URL after a
// preview, in the order the teacher sets. It edits `formModel.documents`,
// which the cases controller sends as the case's `documents` field.
import {
    MAX_CASE_DOCUMENTS,
    addCaseDocument,
    caseDocumentControlKey,
    caseDocumentFromPreview,
    caseDocumentIconClass,
    caseDocumentName,
    caseDocumentTypeKey,
    caseDocumentWarningKey,
    checkCaseDocumentKey,
    checkCaseDocumentUrl,
    documentPreviewErrorKey,
    formatDocumentModifiedTime,
    isPublishedCaseDocument,
    moveCaseDocument,
    removeCaseDocument,
} from "../helpers/case-documents-form.js";
import { moveFocusDirection } from "../helpers/ordered-list.js";
import { googleDocumentKey } from "../../../../common/modules/google-document-urls.js";

const TEMPLATE_DIRECTORY = "/assets/static/views/teacher/fragments";

const CaseAttachedDocumentsEditorController = function($scope, $window, $timeout, $translate,
    CasesCatalogService) {
    const vm = this;
    // Answers to an earlier preview request are ignored once another starts.
    let previewRequestId = 0;

    vm.$onInit = function() {
        vm.maxCaseDocuments = MAX_CASE_DOCUMENTS;
        vm.documentSupport = "loading";
        vm.resetDocumentInput();
        vm.loadDocumentSupport();
    };

    vm.loadDocumentSupport = async function() {
        try {
            const support = await CasesCatalogService.getCaseDocumentSupport();
            vm.documentSupport = support.enabled ? "enabled" : "disabled";
        } catch (error) {
            console.error("[caseAttachedDocumentsEditor] Could not check document support.", error);
            vm.documentSupport = "error";
        }
        $scope.$applyAsync();
    };

    vm.resetDocumentInput = function() {
        previewRequestId += 1;
        vm.documentUrl = "";
        vm.documentPreview = null;
        vm.documentPreviewErrorKey = "";
        vm.isPreviewingDocument = false;
    };

    vm.getDocuments = function() {
        return Array.isArray(vm.formModel?.documents) ? vm.formModel.documents : [];
    };

    vm.getSupportHelpKey = function() {
        if (vm.documentSupport === "disabled") {
            return "case_documents_not_configured";
        }
        if (vm.documentSupport === "error") {
            return "case_documents_support_error";
        }
        return "";
    };

    vm.isSupportEnabled = function() {
        return vm.documentSupport === "enabled";
    };

    // Disabled while support loads, when it is off and on locked cases.
    vm.isToggleDisabled = function() {
        return vm.isLocked === true || !vm.isSupportEnabled();
    };

    // The list is editable unless the case is locked. Documents already in a
    // case can be reordered and removed even when support is not configured.
    vm.canEditDocuments = function() {
        return vm.isLocked !== true;
    };

    vm.canAddDocuments = function() {
        return vm.canEditDocuments() && vm.isSupportEnabled() && !vm.isListFull();
    };

    vm.isListFull = function() {
        return vm.getDocuments().length >= MAX_CASE_DOCUMENTS;
    };

    vm.areDocumentsShown = function() {
        return vm.formModel?.includesDocuments === true || vm.getDocuments().length > 0;
    };

    vm.onIncludesDocumentsChange = function() {
        if (vm.formModel.includesDocuments || vm.getDocuments().length === 0) {
            vm.resetDocumentInput();
            return;
        }

        const message = $translate.instant("case_documents_remove_all_confirmation", {
            count: vm.getDocuments().length,
        });
        if (!$window.confirm(message)) {
            vm.formModel.includesDocuments = true;
            return;
        }

        vm.formModel.documents = [];
        vm.formModel.documentFieldErrors = {};
        vm.resetDocumentInput();
    };

    vm.onDocumentUrlKeydown = function(event) {
        // Enter previews the document instead of submitting the case form.
        if (event.key === "Enter" && !event.isComposing) {
            event.preventDefault();
            vm.previewDocument();
        }
    };

    // Editing the URL drops its preview, and any preview still on its way.
    vm.onDocumentUrlChange = function() {
        previewRequestId += 1;
        vm.isPreviewingDocument = false;
        vm.documentPreview = null;
        vm.documentPreviewErrorKey = "";
    };

    vm.previewDocument = async function() {
        if (!vm.canAddDocuments() || vm.isPreviewingDocument) {
            return;
        }

        vm.documentPreview = null;
        const check = checkCaseDocumentUrl(vm.getDocuments(), vm.documentUrl);
        if (!check.ok) {
            vm.documentPreviewErrorKey = check.errorKey;
            return;
        }

        vm.documentPreviewErrorKey = "";
        vm.isPreviewingDocument = true;
        previewRequestId += 1;
        const requestId = previewRequestId;
        try {
            const preview = await CasesCatalogService.previewCaseDocument(vm.documentUrl.trim());
            if (requestId !== previewRequestId) {
                return;
            }
            vm.documentPreview = caseDocumentFromPreview(preview);
            vm.announce(vm.documentPreview, "case_documents_preview_ready_announcement");
        } catch (error) {
            if (requestId !== previewRequestId) {
                return;
            }
            vm.documentPreviewErrorKey = documentPreviewErrorKey(error);
        } finally {
            if (requestId === previewRequestId) {
                vm.isPreviewingDocument = false;
            }
            $scope.$applyAsync();
        }
    };

    vm.confirmDocumentPreview = function() {
        const caseDocument = vm.documentPreview;
        if (!caseDocument || !vm.canAddDocuments()) {
            return;
        }

        // A drive.google.com link may preview as a Doc already in the list.
        const check = checkCaseDocumentKey(vm.getDocuments(), googleDocumentKey(caseDocument));
        if (!check.ok) {
            vm.documentPreviewErrorKey = check.errorKey;
            vm.documentPreview = null;
            return;
        }

        vm.formModel.documents = addCaseDocument(vm.getDocuments(), caseDocument);
        vm.formModel.includesDocuments = true;
        vm.resetDocumentInput();
        vm.announce(caseDocument, "case_documents_added_announcement");
        vm.focusElement("caseDocumentUrl");
    };

    vm.discardDocumentPreview = function() {
        vm.resetDocumentInput();
        vm.focusElement("caseDocumentUrl");
    };

    vm.moveDocument = function(index, offset) {
        if (!vm.canEditDocuments()) {
            return;
        }

        const documents = vm.getDocuments();
        const moved = moveCaseDocument(documents, index, offset);
        if (moved === documents) {
            return;
        }

        const caseDocument = documents[index];
        const position = index + offset;
        vm.formModel.documents = moved;
        vm.announce(caseDocument, "case_documents_moved_announcement", {
            position: position + 1,
            count:    moved.length,
        });
        // Keeps the keyboard on the moved document.
        vm.focusElement(vm.getControlId(caseDocument,
            moveFocusDirection(offset, position, moved.length)));
    };

    vm.removeDocument = function(index) {
        if (!vm.canEditDocuments()) {
            return;
        }

        const caseDocument = vm.getDocuments()[index];
        if (!caseDocument) {
            return;
        }

        vm.formModel.documents = removeCaseDocument(vm.getDocuments(), index);
        if (vm.formModel.documentFieldErrors) {
            delete vm.formModel.documentFieldErrors[googleDocumentKey(caseDocument)];
        }
        vm.announce(caseDocument, "case_documents_removed_announcement");
        const next = vm.formModel.documents[Math.min(index, vm.formModel.documents.length - 1)];
        vm.focusElement(next ? vm.getControlId(next, "remove") : "caseIncludesDocuments");
    };

    // Tells screen readers what happened to a document. Names are appended,
    // not passed as translation parameters, which the app sanitizes as HTML.
    vm.announce = function(caseDocument, key, values) {
        vm.announcement = `${$translate.instant(key, values)} ${caseDocumentName(caseDocument)}`;
    };

    vm.focusElement = function(elementId) {
        $timeout(() => {
            $window.document.getElementById(elementId)?.focus();
        });
    };

    vm.getControlId = function(caseDocument, control) {
        return `caseDocument-${caseDocumentControlKey(caseDocument)}-${control}`;
    };

    vm.getTrackKey = googleDocumentKey;
    vm.getName = caseDocumentName;
    vm.getTypeKey = caseDocumentTypeKey;
    vm.getIconClass = caseDocumentIconClass;
    vm.getWarningKey = caseDocumentWarningKey;
    vm.isPublished = isPublishedCaseDocument;

    vm.formatModifiedTime = function(caseDocument) {
        const modifiedTime = caseDocument?.availability?.modifiedTime;
        return formatDocumentModifiedTime(modifiedTime, $translate.use());
    };

    vm.getFieldErrorKey = function(caseDocument) {
        return vm.formModel?.documentFieldErrors?.[googleDocumentKey(caseDocument)] || "";
    };
};

const caseAttachedDocumentsEditorComponent = {
    bindings: {
        formModel: "=",
        isLocked:  "<",
    },
    controller: [
        "$scope", "$window", "$timeout", "$translate", "CasesCatalogService",
        CaseAttachedDocumentsEditorController,
    ],
    templateUrl: `${TEMPLATE_DIRECTORY}/case-attached-documents-editor.template.html`,
};

export default caseAttachedDocumentsEditorComponent;
