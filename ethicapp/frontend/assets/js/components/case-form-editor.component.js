const CaseFormEditorController = function() {
    const vm = this;

    vm.$onInit = function() {
        vm.hasAttemptedSubmit = false;
    };

    vm.onSubmit = function(form) {
        vm.hasAttemptedSubmit = true;
        if (!form || !form.$valid || !vm.onSave) {
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
};

const caseFormEditorComponent = {
    bindings: {
        formModel:      "=",
        submitLabelKey: "@",
        isPdfRequired:  "<",
        showCurrentPdf: "<",
        onSave:         "&",
        onCancel:       "&",
        onPdfSelected:  "&",
    },
    controller:  CaseFormEditorController,
    templateUrl: "/assets/static/views/teacher/fragments/case-form-editor.template.html",
};

export default caseFormEditorComponent;
