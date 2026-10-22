import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ExternalServicesRegistry } from "../external-services.service.js";
import { captureWarnings } from "./capture-warnings.mjs";
import { received, validateCaseAnalysisDocument } from "./fixtures/case-analysis-tool.adapter.js";

// registerService() resolves adapter paths against the manifest path; the
// manifest file itself is never read.
const FIXTURES_MANIFEST = fileURLToPath(new URL("./fixtures/manifest.json", import.meta.url));
const JOB_ID            = "e1f2a3b4-0000-4000-8000-000000000041";
const UUID_PATTERN      = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Records the calls that the bound functions make to the case analyses store.
function makeStore({ processingRow = { status: "processing" } } = {}) {
    const calls = [];
    const record = (name, result) => async args => {
        calls.push({ name, args });
        return result;
    };

    return {
        calls,
        store: {
            markCaseAnalysisProcessing: record("markCaseAnalysisProcessing", processingRow),
            completeCaseAnalysis:       record("completeCaseAnalysis", { status: "ready" }),
            failCaseAnalysis:           record("failCaseAnalysis", { status: "failed" }),
        },
    };
}

// The fixture has no UI translations, so the case-scope warning is silenced.
async function registerCaseTool(store) {
    const registry = new ExternalServicesRegistry({ jobsService: {}, caseAnalysesStore: store });
    await captureWarnings(() => registry.registerService({
        id:      "svc-case",
        adapter: "./case-analysis-tool.adapter.js",
        scopes:  ["case"],
        enabled: true,
    }, FIXTURES_MANIFEST));
    return registry;
}

// ─── caseAnalyses passed to register() ───────────────────────────────────────

test("registerService: passes case analyses functions bound to the service id", async () => {
    const { store, calls } = makeStore();
    await registerCaseTool(store);
    const document = { words: 12 };
    const failure  = { errorCode: "timeout", errorMessage: "No answer." };

    await received.caseAnalyses.markProcessing({ caseId: 7, jobId: JOB_ID });
    await received.caseAnalyses.complete({ jobId: JOB_ID, documentSchema: "check/v1", document });
    await received.caseAnalyses.fail({ jobId: JOB_ID, ...failure });

    assert.deepEqual(calls, [
        {
            name: "markCaseAnalysisProcessing",
            args: { caseId: 7, serviceId: "svc-case", jobId: JOB_ID },
        },
        {
            name: "completeCaseAnalysis",
            args: { serviceId: "svc-case", jobId: JOB_ID, documentSchema: "check/v1", document },
        },
        {
            name: "failCaseAnalysis",
            args: { serviceId: "svc-case", jobId: JOB_ID, ...failure },
        },
    ]);
});

test("caseAnalyses.markProcessing: returns the analysis with the generation's job id", async () => {
    const { store } = makeStore();
    await registerCaseTool(store);

    assert.deepEqual(
        await received.caseAnalyses.markProcessing({ caseId: 7, jobId: JOB_ID }),
        { status: "processing", jobId: JOB_ID }
    );
});

test("caseAnalyses.markProcessing: uses a local job id when the dispatch has none", async () => {
    const { store, calls } = makeStore();
    await registerCaseTool(store);

    const analysis = await received.caseAnalyses.markProcessing({ caseId: 7, jobId: null });

    assert.match(analysis.jobId, UUID_PATTERN);
    assert.equal(calls[0].args.jobId, analysis.jobId);
});

test("caseAnalyses.markProcessing: null when the service was not chosen for the case", async () => {
    const { store } = makeStore({ processingRow: null });
    await registerCaseTool(store);

    assert.equal(await received.caseAnalyses.markProcessing({ caseId: 7, jobId: JOB_ID }), null);
});

// ─── validators and scopes ───────────────────────────────────────────────────

test("getCaseAnalysisValidator: the adapter's validator, or null without one", async () => {
    const registry = await registerCaseTool(makeStore().store);
    await registry.registerService({
        id:      "svc-chat",
        adapter: "./untranslated-tool.adapter.js",
        scopes:  ["chat"],
        enabled: true,
    }, FIXTURES_MANIFEST);

    assert.equal(registry.getCaseAnalysisValidator("svc-case"), validateCaseAnalysisDocument);
    assert.equal(registry.getCaseAnalysisValidator("svc-chat"), null);
    assert.equal(registry.getCaseAnalysisValidator("svc-unknown"), null);
});

test("getEnabledServiceIdsForScope: lists the enabled services that declare the scope", () => {
    const registry = new ExternalServicesRegistry({ jobsService: {} });
    registry.services.set("case-a", { id: "case-a", enabled: true, scopes: ["case"] });
    registry.services.set("case-off", { id: "case-off", enabled: false, scopes: ["case"] });
    registry.services.set("chat-a", { id: "chat-a", enabled: true, scopes: ["chat"] });
    registry.services.set("legacy", { id: "legacy", enabled: true });

    assert.deepEqual(registry.getEnabledServiceIdsForScope("case"), ["case-a"]);
    assert.deepEqual(registry.getEnabledServiceIdsForScope("response"), []);
});
