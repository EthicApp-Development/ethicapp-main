const CaseFormEditorController = function() {
    const vm = this;

    vm.$onInit = function() {
        vm.hasAttemptedSubmit = false;
        vm.ensureAuthors();
        vm.visibilityOptions = [
            { value: "private", labelKey: "visibility_private" },
            { value: "public", labelKey: "visibility_public" },
        ];
        vm.rightsStatusOptions = [
            { value: "own_work", labelKey: "rights_status_own_work" },
            { value: "open_license", labelKey: "rights_status_open_license" },
            { value: "used_with_permission", labelKey: "rights_status_used_with_permission" },
            { value: "commercial_license", labelKey: "rights_status_commercial_license" },
            { value: "public_domain", labelKey: "rights_status_public_domain" },
            { value: "unknown", labelKey: "rights_status_unknown" },
        ];
    };

    vm.onSubmit = function(form) {
        vm.hasAttemptedSubmit = true;
        vm.ensureAuthors();
        if (!form || !form.$valid || vm.hasDuplicateAuthorEmails() || !vm.onSave) {
            return;
        }

        vm.onSave();
    };

    vm.shouldShowError = function(control) {
        if (!control) {
            return false;
        }

        return control.$invalid && (control.$touched || vm.hasAttemptedSubmit);
    };

    vm.handlePdfSelected = function(files) {
        if (vm.onPdfSelected) {
            vm.onPdfSelected({ files });
        }
    };

    vm.ensureAuthors = function() {
        if (!vm.formModel) {
            return;
        }

        if (!Array.isArray(vm.formModel.authors) || vm.formModel.authors.length === 0) {
            vm.formModel.authors = [{
                authorFirstname: "",
                authorLastname: "",
                authorEmail: "",
                isPrimary: true,
            }];
        }

        vm.formModel.authors.forEach((author, index) => {
            author.isPrimary = index === 0;
        });
    };

    vm.normalizeAuthorEmail = function(author) {
        return String(author?.authorEmail || "").trim().toLowerCase();
    };

    vm.getDuplicateAuthorEmailSet = function() {
        vm.ensureAuthors();
        const counts = new Map();
        vm.formModel.authors.forEach((author) => {
            const email = vm.normalizeAuthorEmail(author);
            if (email) {
                counts.set(email, (counts.get(email) || 0) + 1);
            }
        });

        return new Set(
            Array.from(counts.entries())
                .filter((entry) => entry[1] > 1)
                .map((entry) => entry[0])
        );
    };

    vm.hasDuplicateAuthorEmails = function() {
        return vm.getDuplicateAuthorEmailSet().size > 0;
    };

    vm.isDuplicateAuthorEmail = function(author) {
        const email = vm.normalizeAuthorEmail(author);
        return Boolean(email) && vm.getDuplicateAuthorEmailSet().has(email);
    };

    vm.addAuthor = function() {
        vm.ensureAuthors();
        vm.formModel.authors.push({
            authorFirstname: "",
            authorLastname: "",
            authorEmail: "",
            isPrimary: false,
        });
    };

    vm.removeAuthor = function(index) {
        vm.ensureAuthors();
        if (vm.formModel.authors.length <= 1) {
            return;
        }

        vm.formModel.authors.splice(index, 1);
        vm.ensureAuthors();
    };

    vm.syncRightsDefaults = function() {
        if (!vm.formModel) {
            return;
        }

        switch (vm.formModel.rightsStatus) {
        case "commercial_license":
            vm.formModel.licenseCode = "COMMERCIAL_LICENSE";
            vm.formModel.canBeSharedPublicly = false;
            vm.formModel.canBeCopiedByOthers = false;
            break;
        case "used_with_permission":
            vm.formModel.licenseCode = "USED_WITH_PERMISSION";
            vm.formModel.canBeSharedPublicly = false;
            vm.formModel.canBeCopiedByOthers = false;
            break;
        case "open_license":
            vm.formModel.licenseCode = vm.formModel.licenseCode && vm.formModel.licenseCode.startsWith("CC-")
                ? vm.formModel.licenseCode
                : "CC-BY-NC-SA-4.0";
            vm.formModel.canBeSharedPublicly = true;
            vm.formModel.canBeCopiedByOthers = true;
            break;
        case "public_domain":
        case "own_work":
            vm.formModel.canBeSharedPublicly = true;
            vm.formModel.canBeCopiedByOthers = true;
            break;
        default:
            vm.formModel.canBeSharedPublicly = false;
            vm.formModel.canBeCopiedByOthers = false;
            break;
        }
    };
};

const caseFormEditorComponent = {
    bindings: {
        formModel:      "=",
        submitLabelKey: "@",
        isPdfRequired:  "<",
        showCurrentPdf: "<",
        licenses:       "<",
        languages:      "<",
        currentUserProfile: "<",
        onSave:         "&",
        onCancel:       "&",
        onPdfSelected:  "&",
    },
    controller:  CaseFormEditorController,
    templateUrl: "/assets/static/views/teacher/fragments/case-form-editor.template.html",
};

export default caseFormEditorComponent;
