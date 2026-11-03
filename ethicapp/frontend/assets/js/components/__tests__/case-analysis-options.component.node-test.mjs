// The creation form's AI analysis options, and their "add" mode for the case
// view's "Add analysis" dialog (#1039).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import caseAnalysisOptionsComponent from "../case-analysis-options.component.js";

const CaseAnalysisOptionsController = caseAnalysisOptionsComponent.controller.at(-1);

const SERVICES = [
    { id: "mock-case-analysis" },
    { id: "case-evaluation" },
    { id: "case-topic-listing" },
];

function createOptions(bindings, { services = SERVICES } = {}) {
    const requests = [];
    const catalog = {
        getServices: async (options) => {
            requests.push(options);
            if (services instanceof Error) {
                throw services;
            }
            return services;
        },
    };
    const languageCatalog = { getCurrentUiLanguageCode: () => "en_US" };
    const vm = new CaseAnalysisOptionsController({ $applyAsync() {} }, catalog, languageCatalog);
    Object.assign(vm, bindings);
    return { vm, requests };
}

describe("caseAnalysisOptions", () => {
    it("offers every usable case service, asked again, with the switch off", async () => {
        const formModel = { analysisEnabled: false, analysisSelection: {} };
        const { vm, requests } = createOptions({ formModel });

        vm.$onInit();
        await vm.loadServices();

        assert.deepEqual(requests.at(-1), { scopes: ["case"], reload: true });
        assert.deepEqual(vm.services, SERVICES);
        assert.equal(vm.isAddMode(), false);
        assert.equal(vm.isEnabled(), false);
        assert.equal(vm.selectionErrorKey(), "case_analysis_validation_select_tool");
    });

    it("in add mode, leaves out the case's services and keeps the choice on", async () => {
        const formModel = { analysisSelection: { "case-evaluation": true } };
        const loaded = [];
        const { vm } = createOptions({
            formModel,
            mode:               "add",
            excludedServiceIds: ["case-evaluation"],
            onServicesLoaded:   ({ services }) => loaded.push(services),
        });

        vm.$onInit();
        assert.equal(vm.isEnabled(), true, "no switch to turn on");
        await vm.loadServices();

        assert.deepEqual(
            vm.services.map(service => service.id),
            ["mock-case-analysis", "case-topic-listing"]
        );
        assert.deepEqual(formModel.analysisSelection, {}, "a chosen service is not sent again");
        assert.deepEqual(loaded.at(-1), vm.services);
        assert.equal(vm.selectionErrorKey(), "case_analysis_add_select_tool");
    });

    it("tells its host when nothing is left to add or the services fail to load", async () => {
        for (const services of [SERVICES, new Error("offline")]) {
            const loaded = [];
            const { vm } = createOptions({
                formModel:          { analysisSelection: {} },
                mode:               "add",
                excludedServiceIds: SERVICES.map(service => service.id),
                onServicesLoaded:   ({ services: offered }) => loaded.push(offered),
            }, { services });

            const originalError = console.error;
            console.error = () => {};
            try {
                await vm.loadServices();
            } finally {
                console.error = originalError;
            }

            assert.deepEqual(loaded, [[]]);
            assert.equal(vm.hasServices(), false);
        }
    });
});
