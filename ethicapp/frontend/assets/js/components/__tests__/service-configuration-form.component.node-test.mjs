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

async function createForm(configuration = {}, {
    fields = FIELDS,
    serviceId = "argumentation-tutor-system",
} = {}) {
    const vm = new ServiceConfigurationFormController(
        { $id: 4, $applyAsync: () => {} },
        { $on: () => () => {} },
        { instant: key => key },
        { getInstanceConfiguration: async () => ({ available: true, fields }) }
    );
    vm.serviceId = serviceId;
    vm.phase = { externalServices: {
        enabledServiceIds: [serviceId],
        configurations:    Object.keys(configuration).length > 0
            ? { [serviceId]: { ...configuration } }
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

// Polyadic's mode and its advanced `topic_tracking`, which applies to
// `contentCoverage` rooms only (ethicapp-ai-additions#314, #319), as the
// instance configuration route returns them.
const POLYADIC = "polyadic-agent";
const PIPELINE = enumField("pipeline_type", "Modo de discusión", "General", 10, "standard",
    [entry("standard"), entry("devilsAdvocate"), entry("contentCoverage")]);
const TOPIC_TRACKING = {
    key:          "topic_tracking",
    type:         "boolean",
    required:     false,
    default:      true,
    label:        "Seguimiento de temas",
    description:  null,
    group:        "advanced",
    order:        90,
    status:       "active",
    supersededBy: null,
    validation:   {},
    appliesWhen:  [{ field: "pipeline_type", in: ["contentCoverage"] }],
};
const POLYADIC_FIELDS = Object.freeze([FIELDS[0], PIPELINE, TOPIC_TRACKING]);

function polyadicForm(configuration = {}) {
    return createForm(configuration, { fields: POLYADIC_FIELDS, serviceId: POLYADIC });
}

function shownKeys(vm) {
    return vm.sections.flatMap(section => section.fields.map(field => field.key));
}

function stored(vm) {
    return vm.phase.externalServices.configurations[POLYADIC];
}

describe("service configuration form: fields that apply to some modes only (#1234)", () => {
    it("shows topic_tracking under the advanced options only for contentCoverage", async () => {
        const coverage = await polyadicForm({ pipeline_type: "contentCoverage" });
        assert.deepEqual(shownKeys(coverage), ["llm_tier", "pipeline_type", "topic_tracking"]);
        assert.equal(coverage.hasAdvancedSection(), true);
        assert.equal(coverage.advancedOpen, false);

        for (const configuration of [{}, { pipeline_type: "devilsAdvocate" }]) {
            const vm = await polyadicForm(configuration);
            assert.deepEqual(shownKeys(vm), ["llm_tier", "pipeline_type"]);
            assert.equal(vm.hasAdvancedSection(), false);
        }
    });

    it("shows and hides it as the teacher changes the mode, keeping its value", async () => {
        const vm = await polyadicForm();

        vm.values.pipeline_type = "contentCoverage";
        vm.onChange(PIPELINE);
        assert.deepEqual(shownKeys(vm), ["llm_tier", "pipeline_type", "topic_tracking"]);

        vm.toggle(TOPIC_TRACKING);
        assert.deepEqual(stored(vm), { pipeline_type: "contentCoverage", topic_tracking: false });

        vm.values.pipeline_type = "devilsAdvocate";
        vm.onChange(PIPELINE);
        assert.deepEqual(shownKeys(vm), ["llm_tier", "pipeline_type"]);
        assert.equal(vm.hasAdvancedSection(), false);
        assert.deepEqual(stored(vm), { pipeline_type: "devilsAdvocate", topic_tracking: false });

        vm.values.pipeline_type = "";
        vm.onChange(PIPELINE);
        assert.deepEqual(shownKeys(vm), ["llm_tier", "pipeline_type"], "the default mode");

        vm.values.pipeline_type = "contentCoverage";
        vm.onChange(PIPELINE);
        assert.equal(vm.effectiveBoolean(TOPIC_TRACKING), false, "the kept value comes back");
    });

    it("a value kept for another mode neither blocks the design nor opens the options", async () => {
        const counts = [];
        const vm = await polyadicForm({ pipeline_type: "devilsAdvocate", topic_tracking: "yes" });
        vm.onErrorsChange = ({ count }) => counts.push(count);
        vm.validate();

        assert.deepEqual(vm.errors, {});
        assert.deepEqual(vm.notices.byField, {});
        assert.equal(vm.advancedOpen, false);
        assert.deepEqual(counts, [0]);

        vm.values.pipeline_type = "contentCoverage";
        vm.onChange(PIPELINE);
        assert.deepEqual(vm.errors, { topic_tracking: "invalid_type" });
        assert.equal(vm.advancedOpen, true);
        assert.deepEqual(counts.at(-1), 1);
    });

    it("keeps the sections of a descriptor without applies_when as they were", async () => {
        const vm = await createForm();
        const sections = vm.sections;

        vm.values.llm_tier = "advanced";
        vm.onChange(FIELDS[0]);

        assert.equal(vm.sections, sections, "no rebuild for a field no condition names");
        assert.deepEqual(vm.phase.externalServices.configurations,
            { "argumentation-tutor-system": { llm_tier: "advanced" } });
    });
});
