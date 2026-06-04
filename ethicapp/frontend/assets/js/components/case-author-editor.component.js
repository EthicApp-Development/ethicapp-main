const CaseAuthorEditorController = function() {
    const vm = this;

    vm.getCurrentUserEmail = function() {
        return vm.currentUserProfile?.email || vm.currentUserProfile?.mail || "";
    };

    vm.applyCurrentUserAsAuthor = function() {
        if (!vm.useCurrentUser || !vm.currentUserProfile || !vm.author) {
            return;
        }

        vm.author.authorFirstname = vm.currentUserProfile.firstname || "";
        vm.author.authorLastname = vm.currentUserProfile.lastname || "";
        vm.author.authorEmail = vm.getCurrentUserEmail();
    };

    vm.onUseCurrentUserChanged = function() {
        vm.applyCurrentUserAsAuthor();
    };

    vm.getFieldValue = function(fieldName) {
        return String(vm.author?.[fieldName] || "").trim();
    };

    vm.isFieldMissing = function(fieldName) {
        return !vm.getFieldValue(fieldName);
    };

    vm.isEmailInvalid = function() {
        const email = vm.getFieldValue("authorEmail");
        return Boolean(email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    };

    vm.shouldShowRequiredError = function(fieldName) {
        return vm.hasAttemptedSubmit && vm.isFieldMissing(fieldName);
    };

    vm.shouldShowEmailError = function() {
        return vm.hasAttemptedSubmit && vm.isEmailInvalid();
    };
};

const caseAuthorEditorComponent = {
    bindings: {
        author:             "=",
        authorIndex:        "<",
        isPrimary:          "<",
        canRemove:          "<",
        isDuplicateEmail:   "<",
        hasAttemptedSubmit: "<",
        currentUserProfile: "<",
        useCurrentUser:     "=",
        isReadonly:         "<",
        onRemove:           "&",
    },
    controller:  CaseAuthorEditorController,
    templateUrl: "/assets/static/views/teacher/fragments/case-author-editor.template.html",
};

export default caseAuthorEditorComponent;
