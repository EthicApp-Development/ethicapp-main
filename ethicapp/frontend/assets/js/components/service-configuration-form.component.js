// Configuration form for one external service in one design phase (#732).
// Built from the service's capability descriptor fields, loaded in the UI
// language (#745), and stored in `phase.externalServices.configurations`
// (#729). The rules come from service-configuration-form.js.

import { normalizeExternalServicesConfig } from "../helpers/phase-external-services.js";
import {
    buildFieldSections,
    configurationErrors,
    controlKind,
    defaultText,
    enumOptions,
    errorParameters,
    readControlValue,
    setConfigurationValue,
} from "../helpers/service-configuration-form.js";

function ServiceConfigurationFormController($scope, $rootScope, $translate,
    ExternalServicesCatalogService) {
    const vm = this;

    vm.status = "loading"; // loading | ready | unavailable | none
    vm.stale = false;
    vm.fields = [];
    vm.sections = [];
    vm.values = {};
    vm.options = {};
    vm.errors = {};
    vm.errorParams = {};
    vm.storedEntries = [];
    vm.idPrefix = `service-setting-${$scope.$id}`;

    let serverErrorsByField = {};
    let defaultLabel = $translate.instant("service_settings_default");
    let loadSequence = 0;
    let stopListening = null;

    function configurations() {
        return normalizeExternalServicesConfig(vm.phase).configurations;
    }

    function currentConfiguration() {
        return configurations()[vm.serviceId] || {};
    }

    function reportErrors() {
        vm.onErrorsChange({ serviceId: vm.serviceId, count: Object.keys(vm.errors).length });
    }

    vm.validate = function() {
        const stored = vm.storedConfigurations || [];
        vm.errors = configurationErrors(vm.fields, currentConfiguration(), stored);
        reportErrors();
    };

    // Rebuilds the controls from the stored configuration.
    vm.refresh = function() {
        const configuration = currentConfiguration();
        vm.sections = buildFieldSections(vm.fields, configuration);
        vm.values = {};
        vm.options = {};
        vm.errorParams = {};
        for (const field of vm.fields) {
            const value = configuration[field.key];
            const kind = controlKind(field);
            // A number input only accepts numbers; anything else is reported as invalid.
            const shown = kind === "number" && typeof value !== "number" ? undefined : value;
            vm.values[field.key] = shown;
            if (kind === "select") {
                vm.options[field.key] = enumOptions(field, value);
            }
            vm.errorParams[field.key] = errorParameters(field);
        }
        vm.validate();
    };

    vm.load = async function() {
        const sequence = ++loadSequence;
        if (vm.status !== "ready") {
            vm.status = "loading";
        }

        try {
            const result =
                await ExternalServicesCatalogService.getInstanceConfiguration(vm.serviceId);
            if (sequence !== loadSequence) {
                return;
            }
            if (result.available) {
                vm.fields = result.fields;
                vm.stale = result.stale === true;
                vm.status = "ready";
                vm.refresh();
            } else {
                vm.status = "unavailable";
            }
        } catch (error) {
            if (sequence !== loadSequence) {
                return;
            }
            // 404: the service is unknown, disabled, or declares no descriptor.
            vm.status = error?.status === 404 ? "none" : "unavailable";
        }

        if (vm.status !== "ready") {
            // Stored values stay untouched and are shown read-only.
            vm.storedEntries = Object.entries(currentConfiguration())
                .map(([key, value]) => ({ key, value: JSON.stringify(value) }));
            vm.errors = {};
            reportErrors();
        }
        $scope.$applyAsync();
    };

    vm.controlKind = controlKind;

    vm.placeholder = function(field) {
        return defaultText(field);
    };

    // Descriptor text is interpolated, never passed as a translation parameter:
    // the sanitizeParameters strategy would show it HTML-escaped.
    vm.placeholderText = function(field) {
        const value = defaultText(field);
        return value ? `${defaultLabel}: ${value}` : "";
    };

    vm.isSet = function(field) {
        const value = currentConfiguration()[field.key];
        return value !== undefined && value !== null;
    };

    vm.effectiveBoolean = function(field) {
        const value = currentConfiguration()[field.key];
        return typeof value === "boolean" ? value : field.default === true;
    };

    vm.errorFor = function(field) {
        return vm.errors[field.key] || serverErrorsByField[field.key] || null;
    };

    function store(field, value) {
        setConfigurationValue(configurations(), vm.serviceId, field.key, value);
        delete serverErrorsByField[field.key];
        vm.validate();
    }

    vm.onChange = function(field) {
        store(field, readControlValue(field, vm.values[field.key]));
    };

    vm.toggle = function(field) {
        const next = !vm.effectiveBoolean(field);
        vm.values[field.key] = next;
        store(field, next);
    };

    vm.reset = function(field) {
        store(field, undefined);
        vm.refresh();
    };

    vm.$onInit = function() {
        stopListening = $rootScope.$on("$translateChangeEnd", () => {
            defaultLabel = $translate.instant("service_settings_default");
            vm.load();
        });
        vm.load();
    };

    vm.$onChanges = function(changes) {
        if (changes.serverErrors) {
            serverErrorsByField = {};
            for (const error of changes.serverErrors.currentValue || []) {
                serverErrorsByField[error.field] = error.code;
            }
        }
        if (changes.storedConfigurations && vm.status === "ready") {
            vm.validate();
        }
    };

    vm.$onDestroy = function() {
        stopListening?.();
        loadSequence += 1;
        vm.onErrorsChange({ serviceId: vm.serviceId, count: 0 });
    };
}

const serviceConfigurationFormComponent = {
    bindings: {
        phase:                "<",
        serviceId:            "<",
        storedConfigurations: "<",
        serverErrors:         "<",
        readOnly:             "<",
        onErrorsChange:       "&",
    },
    controller: [
        "$scope",
        "$rootScope",
        "$translate",
        "ExternalServicesCatalogService",
        ServiceConfigurationFormController,
    ],
    templateUrl: "/assets/static/views/teacher/fragments/service-configuration-form.template.html",
};

export default serviceConfigurationFormComponent;
