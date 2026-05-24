const CaseFormEditorController = function() {
    const vm = this;

    vm.$onInit = function() {
        vm.hasAttemptedSubmit = false;
        vm.ensureAuthors();
        vm.visibilityOptions = [
            { value: "private", labelKey: "visibility_private" },
            { value: "public", labelKey: "visibility_public" },
        ];
    };

    vm.isLocked = function() {
        return vm.formModel?.hasLaunchedDesignActivity === true;
    };

    vm.onSubmit = function(form) {
        if (vm.isLocked()) {
            return;
        }

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
