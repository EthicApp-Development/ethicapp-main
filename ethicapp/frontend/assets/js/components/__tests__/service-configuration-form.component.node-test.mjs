import assert from "node:assert/strict";
import { describe, it } from "node:test";

import serviceConfigurationFormComponent from "../service-configuration-form.component.js";

// The controller is the last entry of the component's annotated array.
const ServiceConfigurationFormController = serviceConfigurationFormComponent.controller.at(-1);

function entry(value, status = "active") {
    return { value, label: value, status, supersededBy: status === "deprecated" ? "v19" : null };
}

// The tutor's fields as the instance configuration route returns them: the
// model tier in its usual group, and the rubric in the advanced group
// (ethicapp-ai-additions#275), localized by the service.
function enumField(key, label, group, order, defaultValue, entries) {
    return {
        key,
        type:         "enum",
        required:     false,
        default:      defaultValue,
        label,
        description:  null,
        group,
        order,
        status:       "active",
        supersededBy: null,
        validation:   { entries },
    };
}

const FIELDS = Object.freeze([
    enumField("llm_tier", "Nivel", "General", 1, "basic", [entry("basic"), entry("advanced")]),
    enumField("evaluation_rubric", "Rúbrica", "Avanzado", 2, "v19",
        [entry("v19"), entry("v12", "deprecated")]),
]);

async function createForm(configuration = {}) {
    const vm = new ServiceConfigurationFormController(
        { $id: 4, $applyAsync: () => {} },
        { $on: () => () => {} },
        { instant: key => key },
        { getInstanceConfiguration: async () => ({ available: true, fields: FIELDS }) }
    );
    vm.serviceId = "argumentation-tutor-system";
    vm.phase = { externalServices: {
        enabledServiceIds: ["argumentation-tutor-system"],
        configurations:    Object.keys(configuration).length > 0
            ? { "argumentation-tutor-system": { ...configuration } }
            : {},
    } };
    vm.storedConfigurations = [];
    vm.onErrorsChange = () => {};
    await vm.load();
    return vm;
}

describe("service configuration form: advanced options (#1214)", () => {
    it("starts with the advanced options collapsed behind their link", async () => {
        const vm = await createForm();

        assert.equal(vm.status, "ready");
        assert.equal(vm.hasAdvancedSection(), true);
        assert.equal(vm.advancedOpen, false);
        assert.deepEqual(vm.sections.map(section => section.advanced), [false, true]);
    });

    it("opens and closes them with the link", async () => {
        const vm = await createForm();

        vm.toggleAdvanced();
        assert.equal(vm.advancedOpen, true);
        vm.toggleAdvanced();
        assert.equal(vm.advancedOpen, false);
    });

    it("opens them for a design that stores the deprecated rubric", async () => {
        const vm = await createForm({ evaluation_rubric: "v12" });

        assert.equal(vm.advancedOpen, true);
        assert.equal(vm.noticeFor(FIELDS[1]).kind, "deprecated_value");
    });

    it("keeps them closed when the design stores the default rubric", async () => {
        const vm = await createForm({ evaluation_rubric: "v19" });

        assert.equal(vm.advancedOpen, false);
    });
});
