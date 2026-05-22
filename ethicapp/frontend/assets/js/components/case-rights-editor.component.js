const CaseRightsEditorController = function() {
    const vm = this;

    vm.$onInit = function() {
        vm.rightsStatusOptions = [
            { value: "own_work", labelKey: "rights_status_own_work" },
            { value: "open_license", labelKey: "rights_status_open_license" },
            { value: "used_with_permission", labelKey: "rights_status_used_with_permission" },
            { value: "commercial_license", labelKey: "rights_status_commercial_license" },
            { value: "public_domain", labelKey: "rights_status_public_domain" },
            { value: "unknown", labelKey: "rights_status_unknown" },
        ];
    };

    vm.shouldShowError = function(control) {
        if (!control) {
            return false;
        }

        return control.$invalid && (control.$touched || vm.hasAttemptedSubmit);
    };

    vm.syncRightsDefaults = function() {
        if (!vm.formModel) {
            return;
        }

        switch (vm.formModel.rightsStatus) {
        case "commercial_license":
            vm.formModel.licenseCode = "COMMERCIAL_LICENSE";
            break;
        case "used_with_permission":
            vm.formModel.licenseCode = "USED_WITH_PERMISSION";
            break;
        case "open_license":
            vm.formModel.licenseCode = vm.formModel.licenseCode && vm.formModel.licenseCode.startsWith("CC-")
                ? vm.formModel.licenseCode
                : "CC-BY-NC-SA-4.0";
            break;
        }
    };
};

const caseRightsEditorComponent = {
    bindings: {
        formModel:          "=",
        licenses:           "<",
        formCtrl:           "<?",
        hasAttemptedSubmit: "<",
        isReadonly:         "<",
    },
    controller:  CaseRightsEditorController,
    templateUrl: "/assets/static/views/teacher/fragments/case-rights-editor.template.html",
};

export default caseRightsEditorComponent;
