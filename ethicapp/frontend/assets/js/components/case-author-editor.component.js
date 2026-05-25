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
};

const caseAuthorEditorComponent = {
    bindings: {
        author:             "=",
        authorIndex:        "<",
        isPrimary:          "<",
        canRemove:          "<",
        isDuplicateEmail:   "<",
        currentUserProfile: "<",
        useCurrentUser:     "=",
        isReadonly:         "<",
        onRemove:           "&",
    },
    controller:  CaseAuthorEditorController,
    templateUrl: "/assets/static/views/teacher/fragments/case-author-editor.template.html",
};

export default caseAuthorEditorComponent;
