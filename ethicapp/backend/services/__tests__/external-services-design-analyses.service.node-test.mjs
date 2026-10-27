import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
    ExternalServicesRegistry,
    NON_SESSION_HOOKS,
    SERVICE_SCOPES,
} from "../external-services.service.js";
import { captureWarnings } from "./capture-warnings.mjs";
import {
    received,
    validateDesignAnalysisDocument,
} from "./fixtures/design-analysis-tool.adapter.js";

// registerService() resolves adapter paths against the manifest path; the
// manifest file itself is never read.
const FIXTURES_MANIFEST = fileURLToPath(new URL("./fixtures/manifest.json", import.meta.url));
const JOB_ID            = "a9b8c7d6-0000-4000-8000-000000000091";

// Records the calls that the bound functions make to the design analyses store.
function makeStore({ processingRow = { status: "processing" } } = {}) {
    const calls = [];
    const record = (name, result) => async args => {
        calls.push({ name, args });
        return result;
    };

    return {
        calls,
        store: {
            markDesignAnalysisProcessing: record("markDesignAnalysisProcessing", processingRow),
            completeDesignAnalysis:       record("completeDesignAnalysis", { status: "ready" }),
            failDesignAnalysis:           record("failDesignAnalysis", { status: "failed" }),
        },
    };
}

async function registerDesignTool(store) {
    const registry = new ExternalServicesRegistry({ jobsService: {}, designAnalysesStore: store });
    const { warnings } = await captureWarnings(() => registry.registerService({
        id:       "svc-design",
        adapter:  "./design-analysis-tool.adapter.js",
        scopes:   ["design"],
        requires: ["case-analyst"],
    }, FIXTURES_MANIFEST));
    return { registry, warnings };
}

// ─── scope and hook vocabulary ───────────────────────────────────────────────

test("the design scope is in the vocabulary and the design hooks are non-session", async () => {
    assert.ok(SERVICE_SCOPES.includes("design"));
    assert.ok(NON_SESSION_HOOKS.includes("design-created"));
    assert.ok(NON_SESSION_HOOKS.includes("design-updated"));

    const { registry, warnings } = await registerDesignTool(makeStore().store);
    assert.deepEqual(registry.getServiceById("svc-design").scopes, ["design"]);
    assert.ok(warnings.some(warning => warning.includes("design screens will show the id")));
    assert.ok(!warnings.some(warning => warning.includes("unknown scope")));
});

test("the design hooks follow the current policy version, without a session", async () => {
    const version = Object.freeze({ id: 4, allowedServiceIds: Object.freeze(["case-analyst"]) });
    const registry = new ExternalServicesRegistry({
        jobsService:     {},
        aiServicePolicy: {
            getCurrentPolicyVersion:   async () => version,
            getSessionPolicyVersionId: async () => assert.fail("no session lookup expected"),
        },
    });

    for (const hookName of ["design-created", "design-updated"]) {
        assert.equal(
            await registry.resolveHookPolicyVersion(hookName, { designId: 5 }),
            version,
            hookName
        );
    }
});

// ─── designAnalyses passed to register() ─────────────────────────────────────

test("registerService: passes design analyses functions bound to the service id", async () => {
    const { store, calls } = makeStore();
    await registerDesignTool(store);
    const document = { typologies: [] };
    const failure  = { errorCode: "timeout", errorMessage: "No answer." };

    await received.designAnalyses.markProcessing({ designId: 5, jobId: JOB_ID });
    await received.designAnalyses.complete({ jobId: JOB_ID, documentSchema: "claim-typology/v1", document });
    await received.designAnalyses.fail({ jobId: JOB_ID, ...failure });

    assert.deepEqual(calls, [
        {
            name: "markDesignAnalysisProcessing",
            args: { designId: 5, serviceId: "svc-design", jobId: JOB_ID },
        },
        {
            name: "completeDesignAnalysis",
            args: {
                serviceId: "svc-design", jobId: JOB_ID, documentSchema: "claim-typology/v1", document,
            },
        },
        {
            name: "failDesignAnalysis",
            args: { serviceId: "svc-design", jobId: JOB_ID, ...failure },
        },
    ]);
    assert.ok(received.caseAnalyses, "case analyses access is still passed");
});

test("designAnalyses.markProcessing: the analysis with its job id, or null", async () => {
    const started = makeStore();
    await registerDesignTool(started.store);
    assert.deepEqual(
        await received.designAnalyses.markProcessing({ designId: 5, jobId: JOB_ID }),
        { status: "processing", jobId: JOB_ID }
    );
    assert.equal(await received.designAnalyses.markProcessing({ designId: 5, jobId: null }), null);
    assert.equal(started.calls.length, 1, "nothing is reserved without a job id");

    await registerDesignTool(makeStore({ processingRow: null }).store);
    assert.equal(await received.designAnalyses.markProcessing({ designId: 5, jobId: JOB_ID }), null);
});

// ─── validators and scopes ───────────────────────────────────────────────────

test("getDesignAnalysisValidator: the adapter's validator, or null without one", async () => {
    const { registry } = await registerDesignTool(makeStore().store);
    await registry.registerService({
        id:       "svc-chat",
        adapter:  "./untranslated-tool.adapter.js",
        scopes:   ["chat"],
        requires: ["case-analyst"],
    }, FIXTURES_MANIFEST);

    assert.equal(registry.getDesignAnalysisValidator("svc-design"), validateDesignAnalysisDocument);
    assert.equal(registry.getDesignAnalysisValidator("svc-chat"), null);
    assert.equal(registry.getCaseAnalysisValidator("svc-design"), null);
});

test("getUsableServiceIdsForScope: lists the usable design-scoped services", async () => {
    const registry = new ExternalServicesRegistry({
        jobsService:         {},
        developmentAdapters: true,
        aiServicePolicy:     {
            getCurrentPolicyVersion: async () => ({ id: 1, allowedServiceIds: ["case-analyst"] }),
        },
        isAiAdditionsConfigured: async () => true,
    });
    registry.services.set("design-a", {
        id: "design-a", development: false, requires: ["case-analyst"], scopes: ["design"],
    });
    registry.services.set("design-blocked", {
        id: "design-blocked", development: false, requires: ["argumentation-tutor"], scopes: ["design"],
    });
    registry.services.set("case-a", { id: "case-a", development: true, scopes: ["case"] });

    assert.deepEqual(await registry.getUsableServiceIdsForScope("design"), ["design-a"]);
});
