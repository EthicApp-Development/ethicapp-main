// Publishing a design whose case is private opens the case publication modal,
// which saves only the case's sharing through PATCH /cases/:id/sharing, so it
// works for a case a launched activity uses (#1014).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DesignPublicationService } from "../design-publication.service.js";

const PRIVATE_CASE = {
    id:                        41,
    title:                     "Datos de pacientes",
    visibility:                "private",
    licenseCode:               "CC-BY-NC-SA-4.0",
    hasLaunchedDesignActivity: true,
};

function createService({ modalResult, sharingResult } = {}) {
    const calls = { sharing: [], updateCase: [], toggled: [] };
    const $uibModal = {
        open() {
            return {
                result: modalResult === "cancel"
                    ? Promise.reject(modalResult)
                    : Promise.resolve(modalResult),
            };
        },
    };
    const DesignCatalogService = {
        async togglePublicVisibility(designId) {
            calls.toggled.push(designId);
        },
    };
    const CasesCatalogService = {
        async getCaseById(caseId) {
            return { ...PRIVATE_CASE, id: caseId };
        },
        async getLicenses() {
            return [];
        },
        async getCaseByDesignId() {
            return { ...PRIVATE_CASE };
        },
        async updateCaseSharing(caseId, form) {
            calls.sharing.push({ caseId, form });
            return sharingResult;
        },
        async updateCase(caseId, form) {
            calls.updateCase.push({ caseId, form });
            return form;
        },
    };

    return {
        service: DesignPublicationService($uibModal, DesignCatalogService, CasesCatalogService),
        calls,
    };
}

const MODAL_FORM = {
    title:       "Datos de pacientes",
    visibility:  "public",
    licenseCode: "CC-BY-4.0",
};

describe("DesignPublicationService and a private case", () => {
    it("saves the modal through the sharing endpoint, then publishes the design", async () => {
        const { service, calls } = createService({
            modalResult:   MODAL_FORM,
            sharingResult: {
                id:                41,
                visibility:        "public",
                public:            true,
                licenseCode:       "CC-BY-4.0",
                affectedDesignIds: [],
            },
        });
        const design = { id: 7, caseId: 41, visibility: "private" };

        const result = await service.togglePublicVisibility(design);

        assert.deepEqual(result, { status: "public" });
        assert.deepEqual(calls.sharing, [{ caseId: 41, form: MODAL_FORM }]);
        assert.deepEqual(calls.updateCase, []);
        assert.deepEqual(calls.toggled, [7]);
    });

    it("keeps the rest of the case on the design after the save", async () => {
        const { service } = createService({
            modalResult:   MODAL_FORM,
            sharingResult: { id: 41, visibility: "public", public: true, licenseCode: "CC-BY-4.0" },
        });
        const design = { id: 7, caseId: 41, visibility: "private" };

        await service.togglePublicVisibility(design);

        assert.equal(design.associatedCase.title, "Datos de pacientes");
        assert.equal(design.associatedCase.visibility, "public");
        assert.equal(design.associatedCase.licenseCode, "CC-BY-4.0");
    });

    it("does not publish the design when the saved case is not public", async () => {
        const { service, calls } = createService({
            modalResult:   MODAL_FORM,
            sharingResult: {
                id: 41, visibility: "private", public: false, licenseCode: "CC-BY-4.0",
            },
        });
        const design = { id: 7, caseId: 41, visibility: "private" };

        const result = await service.togglePublicVisibility(design);

        assert.deepEqual(result, { status: "case_not_ready" });
        assert.deepEqual(calls.toggled, []);
        assert.equal(design.visibility, "private");
    });

    it("saves nothing when the modal is cancelled", async () => {
        const { service, calls } = createService({ modalResult: "cancel" });
        const design = { id: 7, caseId: 41, visibility: "private" };

        const result = await service.togglePublicVisibility(design);

        assert.deepEqual(result, { status: "cancelled" });
        assert.deepEqual(calls.sharing, []);
        assert.deepEqual(calls.toggled, []);
    });
});
