import fs from "fs/promises";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { dbconnString } from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import {
    completeCaseAnalysis,
    failCaseAnalysis,
    markCaseAnalysisProcessing,
} from "../helpers/case-analyses-helper.js";
import {
    completeDesignAnalysis,
    failDesignAnalysis,
    markDesignAnalysisProcessing,
} from "../helpers/design-analyses-helper.js";
import { saveChatMessage } from "../helpers/chat-helper.js";
import { describeError, summarizeCallbackResult } from "../helpers/log-safety.js";
import { studentNotifications, teacherNotifications } from "../config/socket.config.js";
import aiAdditionsClient from "./ai-additions-client.service.js";
import {
    getCurrentPolicyVersion,
    getPolicyVersion,
    getSessionPolicyVersionId,
} from "../helpers/ai-service-policy.js";
import {
    assertValidCatalog,
    catalogWarnings,
    developmentAdaptersEnabled,
    validateCatalog,
    validateCatalogEntry,
} from "../external-services/catalog.js";
import { CapabilityDescriptorsClient } from "./capability-descriptors.service.js";
import {
    createPhaseStateLoader,
    isActivePhaseState,
    resolveCallbackDestination,
} from "../helpers/callback-destination.js";
import {
    externalServiceJobsService,
    isRoomJob,
    JOB_STATUS,
    LIVE_ROOM_JOB_STATUSES,
    RESULT_STATUS,
} from "./external-service-jobs.service.js";
import {
    createRoomJobsAccess,
    externalServiceRoomJobsService,
} from "./external-service-room-jobs.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_MANIFEST_PATH = path.join(__dirname, "../external-services/manifest.json");
const HOOK_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export const SERVICE_SCOPES = Object.freeze(["case", "design", "response", "chat"]);
const UI_LOCALES = Object.freeze(["es_CL", "en_US"]);

const UI_TRANSLATIONS_TIMEOUT_MS = 3000;
const UI_TRANSLATIONS_TTL_MS     = 10 * 60 * 1000;
const UI_TRANSLATIONS_RETRY_MS   = 60 * 1000;

// Hooks that fire outside any session. They follow the current AI service
// policy version; every other hook belongs to a session (`context.sessionId`)
// and follows the version that session is pinned to (#815). `design-created`
// and `design-updated` carry design analyses (epic #846, #862;
// helpers/design-analysis-hooks.js). `user-forgotten` asks a service to
// erase what it keeps about a user (#876; see ERASURE_HOOKS).
export const NON_SESSION_HOOKS = Object.freeze([
    "case-created",
    "design-created",
    "design-updated",
    "user-forgotten",
]);

// Hooks that ask an AI service to erase what it keeps about someone (#876).
// They carry an id and no content, and a service the current policy switched
// off may still hold data from when it was allowed, so they skip the policy:
// every registered adapter among the requested ones receives them, provided
// a usable AI Additions connection is stored.
export const ERASURE_HOOKS = Object.freeze([
    "user-forgotten",
]);

const DEFAULT_AI_SERVICE_POLICY = Object.freeze({
    getCurrentPolicyVersion,
    getPolicyVersion,
    getSessionPolicyVersionId,
});

const DEFAULT_CASE_ANALYSES_STORE = Object.freeze({
    markCaseAnalysisProcessing,
    completeCaseAnalysis,
    failCaseAnalysis,
});

const DEFAULT_DESIGN_ANALYSES_STORE = Object.freeze({
    markDesignAnalysisProcessing,
    completeDesignAnalysis,
    failDesignAnalysis,
});

function isValidHookName(hookName) {
    return typeof hookName === "string" && HOOK_NAME_PATTERN.test(hookName);
}

function normalizeHooks(hooks, serviceId) {
    if (!Array.isArray(hooks)) {
        return [];
    }

    return hooks.filter(hookName => {
        const isValid = isValidHookName(hookName);
        if (!isValid) {
            console.warn(`[external-services] Ignoring non-kebab-case hook "${hookName}" in ${serviceId}.`);
        }
        return isValid;
    });
}

// Global hooks are the hooks a service opts into at manifest level, without an
// activity-design opt-in. They are only consulted by dispatchGlobalHook(); every
// entry must be kebab-case and must also be declared in `hooks`.
function normalizeGlobalHooks(globalHooks, hooks, serviceId) {
    if (!Array.isArray(globalHooks)) {
        return [];
    }

    const normalized = [];

    for (const hookName of globalHooks) {
        if (!isValidHookName(hookName)) {
            console.warn(
                `[external-services] Ignoring non-kebab-case global hook "${hookName}" `
                + `in ${serviceId}.`
            );
            continue;
        }

        if (!hooks.includes(hookName)) {
            console.warn(
                `[external-services] Ignoring global hook "${hookName}" in ${serviceId}: `
                + "it is not declared in hooks."
            );
            continue;
        }

        if (!normalized.includes(hookName)) {
            normalized.push(hookName);
        }
    }

    return normalized;
}

// Scopes declare where a service operates: `case` (case documents), `design`
// (activity designs), `response` (student responses) and `chat` (group chat).
// Screens that list services filter by scope instead of guessing from hooks.
function normalizeScopes(scopes, serviceId) {
    if (!Array.isArray(scopes)) {
        return [];
    }

    const normalized = [];

    for (const scope of scopes) {
        if (!SERVICE_SCOPES.includes(scope)) {
            console.warn(
                `[external-services] Ignoring unknown scope "${scope}" in ${serviceId}: `
                + `expected one of ${SERVICE_SCOPES.join(", ")}.`
            );
            continue;
        }

        if (!normalized.includes(scope)) {
            normalized.push(scope);
        }
    }

    return normalized;
}

// `ui.component` names the EthicApp frontend component that shows the service's
// analysis in the case view. It follows the same kebab-case rule as hook names.
function normalizeUi(ui, serviceId) {
    const component = ui?.component ?? null;
    const isValid   = component === null
        || (typeof component === "string" && HOOK_NAME_PATTERN.test(component));

    if (!isValid) {
        console.warn(
            `[external-services] Ignoring non-kebab-case ui.component "${component}" `
            + `in ${serviceId}.`
        );
        return { component: null };
    }

    return { component };
}

// A validated `produces` or `consumes` declaration (catalog.js), copied.
function designAnalysisDeclaration(declaration) {
    return Array.isArray(declaration)
        ? declaration.map(({ documentSchema, unit }) => ({ documentSchema, unit }))
        : [];
}

function normalizeText(value) {
    return typeof value === "string" ? value.trim() : "";
}

// `descriptor` links a service to the capability descriptor its AI service
// publishes (#687, #725). The catalog declares only its `path`, the descriptor
// route relative to the AI Additions connection's base URL (#814): an absolute
// path without host, query or `..` segments. Its `serviceId`, the descriptor's `service.id`, is the one AI
// Additions service the adapter requires (#812). It may differ from the catalog
// id: ids are mapped, not renamed, so stored designs and jobs keep theirs.
function normalizeDescriptor(descriptor, requires, serviceId) {
    if (descriptor === undefined || descriptor === null) {
        return null;
    }

    const descriptorPath = normalizeText(descriptor?.path);
    const isValidPath = descriptorPath.startsWith("/")
        && !descriptorPath.startsWith("//")
        && !/[\s?#\\]/u.test(descriptorPath)
        && !descriptorPath.split("/").includes("..");

    if (requires.length !== 1 || !isValidPath) {
        console.warn(
            `[external-services] Ignoring invalid descriptor in ${serviceId}: expected `
            + "{ path } with an absolute path relative to the AI Additions base URL, and "
            + "exactly one service in requires."
        );
        return null;
    }

    return { serviceId: requires[0], path: descriptorPath };
}

// Adapters provide their own texts through getUiTranslations(): a label, a
// description and an optional case-view tab title for every UI locale. Returns
// null when a locale lacks the label or the description.
function normalizeUiTranslations(translations) {
    const normalized = {};

    for (const locale of UI_LOCALES) {
        const label       = normalizeText(translations?.[locale]?.label);
        const description = normalizeText(translations?.[locale]?.description);

        if (!label || !description) {
            return null;
        }

        normalized[locale] = {
            label,
            description,
            tabTitle: normalizeText(translations[locale].tabTitle) || null,
        };
    }

    return normalized;
}

function withTimeout(promise, timeoutMs) {
    let timeoutId;
    const timeout = new Promise((resolve, reject) => {
        timeoutId = setTimeout(
            () => reject(new Error(`timed out after ${timeoutMs} ms`)),
            timeoutMs
        );
    });

    return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

// Case-scoped adapters record the progress of their analyses through these
// functions, bound to their own service id.
function createCaseAnalysesAccess(store, serviceId) {
    return {
        // Generations are reserved before they are dispatched, under the job
        // id of the dispatch, so this only starts that reservation. Returns
        // null when it is no longer current, and the adapter skips the work.
        // Adapters use the returned jobId for complete() and fail().
        async markProcessing({ caseId, jobId }) {
            if (!jobId) {
                return null;
            }

            const analysis = await store.markCaseAnalysisProcessing({ caseId, serviceId, jobId });
            return analysis ? { ...analysis, jobId } : null;
        },
        complete: ({ jobId, documentSchema, document }) =>
            store.completeCaseAnalysis({ serviceId, jobId, documentSchema, document }),
        fail: ({ jobId, errorCode, errorMessage }) =>
            store.failCaseAnalysis({ serviceId, jobId, errorCode, errorMessage }),
    };
}

// Design-scoped adapters record the progress of their analyses through these
// functions, bound to their own service id, as case-scoped ones do.
function createDesignAnalysesAccess(store, serviceId) {
    return {
        // Starts the generation reserved under the job id of the dispatch.
        // Returns null when it is no longer current, and the adapter skips the
        // work. Adapters use the returned jobId for complete() and fail().
        async markProcessing({ designId, jobId }) {
            if (!jobId) {
                return null;
            }

            const analysis = await store.markDesignAnalysisProcessing({
                designId,
                serviceId,
                jobId,
            });
            return analysis ? { ...analysis, jobId } : null;
        },
        complete: ({ jobId, documentSchema, document }) =>
            store.completeDesignAnalysis({ serviceId, jobId, documentSchema, document }),
        fail: ({ jobId, errorCode, errorMessage }) =>
            store.failDesignAnalysis({ serviceId, jobId, errorCode, errorMessage }),
    };
}

// An instantiation report with its common keys normalized, or null when there
// is nothing to record (#737).
function normalizeInstantiationReport(report) {
    if (report === null || typeof report !== "object" || Array.isArray(report)) {
        return null;
    }
    return {
        ...report,
        warnings:              Array.isArray(report.warnings) ? report.warnings : [],
        degraded:              report.degraded === true,
        configurationRejected: report.configurationRejected === true,
    };
}

// The settings a phase stores for one service (#734): a copy, so a handler
// cannot change the design, or {} for hooks without a phase or settings.
function serviceConfigurationFor(serviceConfigurations, serviceId) {
    const configuration = serviceConfigurations?.[serviceId];
    const isObject = configuration !== null && typeof configuration === "object"
        && !Array.isArray(configuration);
    return isObject ? { ...configuration } : {};
}

// Refuses a callback whose correlation id names another service's job (409),
// and any callback whose result or job lookup failed (503; the caller may
// retry). A callback that matches no job at all goes on to
// resolveCallbackDestination() (#815). The result row stays recorded.
function assertCallbackCorrelation(resultRecord, serviceId) {
    if (!resultRecord) {
        const error = new Error(
            `The callback for ${serviceId} could not be matched to a job; try again later.`
        );
        error.statusCode = 503;
        throw error;
    }

    const belongsToService = resultRecord.service_id === undefined
        || resultRecord.service_id === serviceId;
    if (resultRecord.correlates_other_service === true || (resultRecord.job_id && !belongsToService)) {
        const error = new Error(
            `The callback for ${serviceId} names a job of another service.`
        );
        error.statusCode = 409;
        throw error;
    }
}

// The destination fields a callback target may name. Each one the payload
// names must equal the job's own value; a job without that value (null)
// accepts no target for it.
const CALLBACK_TARGET_FIELDS = Object.freeze(["sessionId", "phaseId", "questionId", "groupId", "userId"]);

function sameId(left, right) {
    return left !== null && left !== undefined && Number(left) === Number(right);
}

/**
 * Checks that the destination a callback payload names stays inside the job
 * it correlates with (#815). `target` comes from the adapter's
 * `getCallbackTarget(requestPayload)`; fields it leaves null or undefined are
 * not named. Throws 409 when a named field differs from the job's.
 * @param {{ sessionId, phaseId, questionId, groupId, userId }} job
 * @param {object|null} target
 * @param {string} serviceId
 */
export function assertCallbackTargetWithinJob(job, target, serviceId) {
    const mismatched = CALLBACK_TARGET_FIELDS.filter(field => {
        const named = target?.[field];
        return named !== null && named !== undefined && !sameId(job?.[field], named);
    });

    if (mismatched.length > 0) {
        const error = new Error(
            `The callback for ${serviceId} targets a ${mismatched.join(", ")} other than its job's.`
        );
        error.statusCode = 409;
        throw error;
    }
}

// The lifecycle hooks that end room jobs (#833), and the phase each one ends:
// phase-ended ends its phase, activity-finished every phase of the session.
const ROOM_JOB_CLOSING_HOOKS = Object.freeze({
    "phase-ended":       context => context?.phaseId ?? null,
    "activity-finished": () => null,
});

function positiveId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function roomJobClosedError(serviceId) {
    return Object.assign(
        new Error(`The callback for ${serviceId} names a closed room job.`),
        { statusCode: 409, code: "callback_room_job_closed" }
    );
}

// Refuses a callback correlated to a room job that no longer accepts callbacks
// (#833): its phase ended, its activity finished, a newer room job of the room
// superseded it, or the room was never created.
function assertRoomJobLive(job, serviceId) {
    if (isRoomJob(job) && !LIVE_ROOM_JOB_STATUSES.includes(job.status)) {
        throw roomJobClosedError(serviceId);
    }
}

/**
 * Refuses a callback without a job that names a bound room (#833): the
 * service acknowledged the correlation id of that room's open room job, so
 * the room's callbacks must carry it. Rooms that are not bound keep the
 * verified-destination rule (#815). A failed lookup answers 503.
 */
async function assertRoomNotBound(roomJobsService, serviceId, destination) {
    let bound;
    try {
        bound = await roomJobsService.hasOpenBoundRoomJob({
            serviceId,
            sessionId: destination.sessionId ?? null,
            phaseId:   destination.phaseId   ?? null,
            groupId:   destination.groupId   ?? null,
        });
    } catch (error) {
        console.error(`[external-services] Could not read the room jobs of a ${serviceId} callback.`, error);
        throw Object.assign(
            new Error("The room of the callback could not be read; try again later."),
            { statusCode: 503, code: "callback_lookup_failed" }
        );
    }
    if (bound) {
        throw Object.assign(
            new Error(`Callback for ${serviceId}: its room is bound to a room job, and it carries none.`),
            { statusCode: 409, code: "callback_room_bound" }
        );
    }
}

export class ExternalServicesRegistry {
    constructor({
        jobsService,
        roomJobsService,
        caseAnalysesStore = DEFAULT_CASE_ANALYSES_STORE,
        designAnalysesStore = DEFAULT_DESIGN_ANALYSES_STORE,
        now = () => Date.now(),
        uiTranslationsTimeoutMs = UI_TRANSLATIONS_TIMEOUT_MS,
        capabilityDescriptors,
        developmentAdapters,
        importAdapter = href => import(href),
        aiServicePolicy = DEFAULT_AI_SERVICE_POLICY,
        isAiAdditionsConfigured = () => aiAdditionsClient.isConfigured(),
        resolveCallbackDestination: resolveDestination = resolveCallbackDestination,
        callbackDestinationLookups = {},
        notifyServiceInstantiated = (sessionId, payload) =>
            teacherNotifications?.serviceInstantiated?.(sessionId, payload),
    } = {}) {
        this.initialized      = false;
        this.services         = new Map();
        this.hookSubscribers  = new Map();
        this._jobsService     = jobsService ?? externalServiceJobsService;
        // Room-scoped jobs (#833), handed to adapters as `roomJobs`.
        this._roomJobsService = roomJobsService ?? externalServiceRoomJobsService;

        // Whether development adapters are registered (and usable). Read from
        // EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS unless a test injects it.
        this._developmentAdapters = developmentAdapters;
        this._importAdapter       = importAdapter;

        // The AI service policy gate (#815): the stored policy versions and
        // session pins, and whether a usable AI Additions connection exists.
        this._aiServicePolicy         = aiServicePolicy;
        this._isAiAdditionsConfigured = isAiAdditionsConfigured;
        // Verifies the destination of callbacks that match no job (#815).
        // `callbackDestinationLookups` ({ loadPhaseState,
        // loadPhaseExternalServices }) replaces its database reads in tests.
        this._resolveCallbackDestination = resolveDestination;
        this._callbackDestinationLookups = callbackDestinationLookups;
        // The phase state a room job's callback is checked against (#833).
        this._loadPhaseState = callbackDestinationLookups.loadPhaseState ?? createPhaseStateLoader();

        this.uiTranslationProviders   = new Map();
        this.uiTranslationsCache      = new Map();
        this._now                     = now;
        this._uiTranslationsTimeoutMs = uiTranslationsTimeoutMs;

        this.caseAnalysisValidators   = new Map();
        this.designAnalysisValidators = new Map();
        // serviceId -> designAnalysisInput({ design, designCase }): whether a
        // design-scoped adapter applies to a design, and its input (#848).
        this.designAnalysisInputBuilders = new Map();
        // serviceId -> needsDesignAnalysis({ documentSchema, unit,
        // configuration }): whether a consumer needs a design analysis in a
        // phase with that configuration of it (#870).
        this.designAnalysisNeedPredicates = new Map();
        // serviceId -> getCallbackTarget(requestPayload): the destination a
        // callback payload names, checked against its job (#815).
        this.callbackTargetResolvers = new Map();
        this._caseAnalysesStore     = caseAnalysesStore;
        this._designAnalysesStore   = designAnalysesStore;
        // Tells the session's teachers that a service reported an
        // instantiation (#865), so their activity view can read it again.
        this._notifyServiceInstantiated = notifyServiceInstantiated;

        this._capabilityDescriptors = capabilityDescriptors ?? new CapabilityDescriptorsClient({
            getDescriptorLink: serviceId => this.getServiceDescriptor(serviceId),
            requestJson:       (pathname, options) => aiAdditionsClient.requestJson(pathname, options),
            getConnectionKey:  () => aiAdditionsClient.getConnectionFingerprint(),
            now,
        });
    }

    get developmentAdaptersEnabled() {
        return this._developmentAdapters ?? developmentAdaptersEnabled();
    }

    // Registers every adapter of the catalog (#812): all production adapters,
    // and the development ones when EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS=true.
    // Registering only subscribes handlers; it must make no outbound call.
    // Whether an adapter receives events is decided at dispatch (the policy
    // gate, effectiveServiceIds).
    // `manifestPath` exists for tests; the application uses the shipped catalog.
    async initialize(manifestPath = DEFAULT_MANIFEST_PATH) {
        if (this.initialized) {
            return;
        }

        this.manifestPath = manifestPath;
        const manifest = await this.readManifest(manifestPath);
        assertValidCatalog(validateCatalog(manifest), manifestPath);
        for (const warning of catalogWarnings(manifest)) {
            console.warn(`[external-services] ${warning}.`);
        }

        for (const service of manifest.services) {
            await this.registerService(service, manifestPath);
        }

        this.initialized = true;
        console.info(`[external-services] Registered ${this.services.size} service adapter(s).`);
    }

    // The catalog is shipped code: a missing or unreadable file stops startup.
    async readManifest(manifestPath) {
        const content = await fs.readFile(manifestPath, "utf8");
        return JSON.parse(content);
    }

    async registerService(service, manifestPath) {
        assertValidCatalog(
            validateCatalogEntry(service).map(problem => `${service?.id ?? "entry"}: ${problem}`),
            manifestPath
        );

        const development = service.development === true;
        if (development && !this.developmentAdaptersEnabled) {
            console.info(
                `[external-services] Skipping development adapter ${service.id}: `
                + "EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS is not true."
            );
            return;
        }

        const hooks = normalizeHooks(service.hooks, service.id);

        if (service.capabilities !== undefined) {
            console.warn(
                `[external-services] Ignoring deprecated "capabilities" in ${service.id}: `
                + "response processing now follows the \"response\" scope (#726)."
            );
        }

        const normalizedService = {
            id:           service.id,
            description:  service.description || "",
            hooks,
            globalHooks:  normalizeGlobalHooks(service.globalHooks, hooks, service.id),
            scopes:       normalizeScopes(service.scopes, service.id),
            ui:           normalizeUi(service.ui, service.id),
            descriptor:   normalizeDescriptor(service.descriptor, service.requires, service.id),
            // The AI Additions services the adapter talks to (#812). The
            // service policy (#815) allows an adapter only when it allows all.
            requires:     [...service.requires],
            // The design analyses the adapter produces and needs (#863), as
            // `{ documentSchema, unit }`. See getDesignAnalysisConsumerIds().
            produces:     designAnalysisDeclaration(service.produces),
            consumes:     designAnalysisDeclaration(service.consumes),
            development,
            adapter:      service.adapter,
            callbackAuth: service.callbackAuth && typeof service.callbackAuth === "object"
                ? {
                    allowedClientIds: Array.isArray(service.callbackAuth.allowedClientIds)
                        ? service.callbackAuth.allowedClientIds.filter(id => typeof id === "string" && id.trim())
                        : [],
                    requiredRoles: Array.isArray(service.callbackAuth.requiredRoles)
                        ? service.callbackAuth.requiredRoles.filter(r => typeof r === "string" && r.trim())
                        : [],
                }
                : null,
        };

        this.services.set(normalizedService.id, normalizedService);

        const adapterUrl = new URL(service.adapter, pathToFileURL(path.resolve(manifestPath)));
        const adapterModule = await this._importAdapter(adapterUrl.href);
        const register = adapterModule.register || adapterModule.default?.register;
        const getUiTranslations = adapterModule.getUiTranslations
            || adapterModule.default?.getUiTranslations;
        const validateCaseAnalysisDocument = adapterModule.validateCaseAnalysisDocument
            || adapterModule.default?.validateCaseAnalysisDocument;
        const validateDesignAnalysisDocument = adapterModule.validateDesignAnalysisDocument
            || adapterModule.default?.validateDesignAnalysisDocument;
        const designAnalysisInput = adapterModule.designAnalysisInput
            || adapterModule.default?.designAnalysisInput;
        const needsDesignAnalysis = adapterModule.needsDesignAnalysis
            || adapterModule.default?.needsDesignAnalysis;
        const getCallbackTarget = adapterModule.getCallbackTarget
            || adapterModule.default?.getCallbackTarget;

        if (typeof getUiTranslations === "function") {
            this.uiTranslationProviders.set(normalizedService.id, getUiTranslations);
        } else if (normalizedService.scopes.includes("case")) {
            console.warn(
                `[external-services] Adapter ${service.adapter} exports no getUiTranslations(), `
                + `so case screens will show the id of ${normalizedService.id}.`
            );
        } else if (normalizedService.scopes.includes("design")) {
            console.warn(
                `[external-services] Adapter ${service.adapter} exports no getUiTranslations(), `
                + `so design screens will show the id of ${normalizedService.id}.`
            );
        }

        if (typeof validateCaseAnalysisDocument === "function") {
            this.caseAnalysisValidators.set(normalizedService.id, validateCaseAnalysisDocument);
        }

        if (typeof validateDesignAnalysisDocument === "function") {
            this.designAnalysisValidators.set(normalizedService.id, validateDesignAnalysisDocument);
        }

        if (typeof designAnalysisInput === "function") {
            this.designAnalysisInputBuilders.set(normalizedService.id, designAnalysisInput);
        } else if (normalizedService.scopes.includes("design")) {
            console.warn(
                `[external-services] Adapter ${service.adapter} exports no designAnalysisInput(), `
                + `so saving a design never runs ${normalizedService.id}.`
            );
        }

        if (typeof needsDesignAnalysis === "function") {
            this.designAnalysisNeedPredicates.set(normalizedService.id, needsDesignAnalysis);
        }

        if (typeof getCallbackTarget === "function") {
            this.callbackTargetResolvers.set(normalizedService.id, getCallbackTarget);
        }

        if (typeof register !== "function") {
            console.warn(`[external-services] Adapter ${service.adapter} does not export register().`);
            return;
        }

        const caseAnalyses = createCaseAnalysesAccess(
            this._caseAnalysesStore,
            normalizedService.id
        );
        const designAnalyses = createDesignAnalysesAccess(
            this._designAnalysesStore,
            normalizedService.id
        );

        await register({
            service:   normalizedService,
            subscribe: (hookName, handler) => {
                this.subscribe(normalizedService.id, hookName, handler);
            },
            publishStudentResult:    payload => this.publishStudentResult(normalizedService.id, payload),
            publishGroupChatMessage: payload => this.publishGroupChatMessage(normalizedService.id, payload),
            aiAdditionsClient,
            caseAnalyses,
            designAnalyses,
            roomJobs:                createRoomJobsAccess(this._roomJobsService, normalizedService.id),
        });
    }

    subscribe(serviceId, hookName, handler) {
        if (!isValidHookName(hookName)) {
            console.warn(`[external-services] Ignoring non-kebab-case hook subscription "${hookName}" from ${serviceId}.`);
            return;
        }

        if (typeof handler !== "function") {
            console.warn(`[external-services] Ignoring non-function handler for ${serviceId}:${hookName}.`);
            return;
        }

        if (!this.hookSubscribers.has(hookName)) {
            this.hookSubscribers.set(hookName, []);
        }

        this.hookSubscribers.get(hookName).push({ serviceId, handler });
    }

    listServices() {
        return Array.from(this.services.values()).map(({
            id,
            description,
            hooks,
            globalHooks = [],
            scopes = [],
            ui = { component: null },
            descriptor = null,
            requires = [],
            development = false,
        }) => ({
            id,
            description,
            hooks,
            globalHooks,
            scopes,
            ui,
            // Only the descriptor id leaves the registry; the route stays internal.
            descriptor: descriptor ? { serviceId: descriptor.serviceId } : null,
            requires,
            development,
        }));
    }

    // The capability descriptor link of a registered service, or null when it
    // is unknown or declares none.
    getServiceDescriptor(serviceId) {
        const descriptor = this.services.get(serviceId)?.descriptor;
        return descriptor ? { ...descriptor } : null;
    }

    // The normalized instance configuration that a usable service's capability
    // descriptor advertises, in the descriptor locale for `locale` (#727). Null for
    // unknown or unusable services (under the current policy version, or
    // `policyVersion` when the caller already read it) and for services without
    // a descriptor; `{ available: false, reason }` when the descriptor cannot be
    // fetched.
    async getServiceInstanceConfiguration(serviceId, locale, { policyVersion } = {}) {
        if (!await this.isServiceUsable(serviceId, { policyVersion })) {
            return null;
        }

        return this._capabilityDescriptors.getInstanceConfiguration(serviceId, locale);
    }

    // Asks the adapter for its UI texts. Valid texts are kept for ten minutes.
    // After a failure the previous texts (or null) are kept for a minute, so an
    // unavailable service does not slow down every listing.
    async getServiceUiTranslations(serviceId) {
        const provider = this.uiTranslationProviders.get(serviceId);
        if (!provider) {
            return null;
        }

        const cached = this.uiTranslationsCache.get(serviceId);
        if (cached && cached.expiresAt > this._now()) {
            return cached.translations;
        }

        try {
            const translations = normalizeUiTranslations(await withTimeout(
                Promise.resolve().then(() => provider()),
                this._uiTranslationsTimeoutMs
            ));

            if (!translations) {
                const locales = UI_LOCALES.join(" and ");
                throw new Error(`expected a label and a description in ${locales}`);
            }

            this.uiTranslationsCache.set(serviceId, {
                translations,
                expiresAt: this._now() + UI_TRANSLATIONS_TTL_MS,
            });
            return translations;
        } catch (error) {
            console.warn(
                `[external-services] UI translations of ${serviceId} are unavailable: `
                + error.message
            );

            const previous = cached?.translations ?? null;
            this.uiTranslationsCache.set(serviceId, {
                translations: previous,
                expiresAt:    this._now() + UI_TRANSLATIONS_RETRY_MS,
            });
            return previous;
        }
    }

    // -- AI service policy gate (#815, epic #810) --
    //
    // effectiveServiceIds() is the one place that decides whether a registered
    // adapter may receive events. Every dispatch path (phase, activity, case
    // and global hooks), every listing and the descriptor lookups go through
    // it. Callbacks are the one exception: one that matches a job goes to the
    // job's destination whatever the policy; one that matches no job is checked
    // against its destination session's pinned version (dispatchServiceHook).
    //
    // - A production adapter passes when every AI Additions service in its
    //   `requires` is in `policyVersion.allowedServiceIds`, its own id is not
    //   in `policyVersion.disabledAdapterIds` (#864), and a usable AI
    //   Additions connection is stored (`isAiAdditionsConfigured`).
    // - A development adapter (the mocks) requires no AI Additions service, so
    //   it passes whenever it is registered, which only happens with
    //   EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS=true, whatever the policy or the
    //   connection.
    //
    // Which version applies is decided by resolveHookPolicyVersion() for
    // hooks; listings, descriptor lookups and callbacks use the current one.

    // Whether `service` is allowed by `policyVersion`, ignoring the connection:
    // its AI Additions services are allowed and the version does not switch
    // the adapter itself off.
    isAllowedByPolicy(service, policyVersion) {
        if (!service) {
            return false;
        }
        if (service.development === true) {
            return this.developmentAdaptersEnabled;
        }

        const allowed = Array.isArray(policyVersion?.allowedServiceIds)
            ? policyVersion.allowedServiceIds
            : [];
        const disabled = Array.isArray(policyVersion?.disabledAdapterIds)
            ? policyVersion.disabledAdapterIds
            : [];
        const requires = Array.isArray(service.requires) ? service.requires : [];
        return requires.length > 0
            && requires.every(id => allowed.includes(id))
            && !disabled.includes(service.id);
    }

    // Whether a usable AI Additions connection is stored. A failure to read it
    // counts as no connection, so nothing is sent.
    async hasAiAdditionsConnection() {
        try {
            return (await this._isAiAdditionsConfigured()) === true;
        } catch (error) {
            console.error("[external-services] Could not read the AI Additions connection.", error);
            return false;
        }
    }

    /**
     * The policy gate: the ids among `requestedIds` that may receive events
     * under `policyVersion`, without duplicates and in order. Unknown ids are
     * dropped. Production adapters also need a usable AI Additions connection;
     * development adapters need neither the policy nor the connection.
     * @param {string[]} requestedIds
     * @param {{ allowedServiceIds: ReadonlyArray<string>,
     *           disabledAdapterIds?: ReadonlyArray<string> } | null} policyVersion
     *        null (no version could be read) allows no production adapter.
     * @returns {Promise<string[]>}
     */
    async effectiveServiceIds(requestedIds = [], policyVersion = null) {
        const allowed = Array.from(new Set(requestedIds))
            .filter(serviceId => this.isAllowedByPolicy(this.services.get(serviceId), policyVersion));

        const needsConnection = allowed.some(serviceId => !this.services.get(serviceId).development);
        if (!needsConnection || await this.hasAiAdditionsConnection()) {
            return allowed;
        }

        return allowed.filter(serviceId => this.services.get(serviceId).development);
    }

    // The current policy version, or null when it cannot be read.
    async getCurrentPolicyVersion() {
        try {
            return await this._aiServicePolicy.getCurrentPolicyVersion();
        } catch (error) {
            console.error("[external-services] Could not read the current AI service policy.", error);
            return null;
        }
    }

    // A policy version by id, or null when it is unknown or cannot be read.
    async getPolicyVersion(versionId) {
        try {
            return await this._aiServicePolicy.getPolicyVersion(versionId);
        } catch (error) {
            console.error(`[external-services] Could not read AI service policy version ${versionId}.`, error);
            return null;
        }
    }

    // The version a session is pinned to, or null when it cannot be read.
    async getSessionPolicyVersion(sessionId) {
        try {
            const versionId = await this._aiServicePolicy.getSessionPolicyVersionId(sessionId);
            return versionId === null ? null : await this._aiServicePolicy.getPolicyVersion(versionId);
        } catch (error) {
            console.error(
                `[external-services] Could not read the AI service policy of session ${sessionId}.`,
                error
            );
            return null;
        }
    }

    // Which policy version a hook follows: the current one for
    // NON_SESSION_HOOKS (case-created, design-created, design-updated), the
    // session's pinned version for every other hook. A session hook without
    // `context.sessionId` follows no version, so only development adapters
    // receive it.
    async resolveHookPolicyVersion(hookName, context = {}) {
        if (NON_SESSION_HOOKS.includes(hookName)) {
            return this.getCurrentPolicyVersion();
        }

        const sessionId = context?.sessionId;
        if (sessionId === undefined || sessionId === null) {
            console.warn(
                `[external-services] Hook ${hookName} has no sessionId, so it follows no AI `
                + "service policy version."
            );
            return null;
        }

        return this.getSessionPolicyVersion(sessionId);
    }

    // The usable ids among `serviceIds` under `policyVersion`, or the current
    // version when it is not given. The current version is read only when a
    // production adapter is among them.
    async usableServiceIds(serviceIds = [], { policyVersion } = {}) {
        const ids = Array.from(new Set(serviceIds)).filter(serviceId => this.services.has(serviceId));
        const needsPolicy = ids.some(serviceId => !this.services.get(serviceId).development);
        const version = policyVersion !== undefined || !needsPolicy
            ? policyVersion ?? null
            : await this.getCurrentPolicyVersion();
        return this.effectiveServiceIds(ids, version);
    }

    // Whether one service is usable (see usableServiceIds).
    async isServiceUsable(serviceId, options = {}) {
        return (await this.usableServiceIds([serviceId], options)).length === 1;
    }

    // The catalog entries of the usable services (see usableServiceIds), in
    // catalog order. Teacher listings and the student descriptor use it.
    async listUsableServices(options = {}) {
        const services = this.listServices();
        const usable = new Set(await this.usableServiceIds(
            services.map(service => service.id),
            options
        ));
        return services.filter(service => usable.has(service.id));
    }

    async getUsableServiceIdsForGlobalHook(hookName, options = {}) {
        return this.usableServiceIds(Array.from(this.services.values())
            .filter(service => Array.isArray(service.globalHooks)
                && service.globalHooks.includes(hookName))
            .map(service => service.id), options);
    }

    async getUsableServiceIdsForScope(scope, options = {}) {
        return this.usableServiceIds(Array.from(this.services.values())
            .filter(service => Array.isArray(service.scopes)
                && service.scopes.includes(scope))
            .map(service => service.id), options);
    }

    // The adapter's optional validateCaseAnalysisDocument(), which checks
    // teacher edits of its analyses, or null when it accepts none.
    getCaseAnalysisValidator(serviceId) {
        return this.caseAnalysisValidators.get(serviceId) || null;
    }

    // The adapter's optional validateDesignAnalysisDocument(), which checks
    // teacher edits of its design analyses, or null when it accepts none.
    getDesignAnalysisValidator(serviceId) {
        return this.designAnalysisValidators.get(serviceId) || null;
    }

    // The adapter's optional designAnalysisInput(), which says whether it
    // applies to a design and computes its input and input hash (#848), or
    // null when it exports none.
    getDesignAnalysisInputBuilder(serviceId) {
        return this.designAnalysisInputBuilders.get(serviceId) || null;
    }

    /**
     * The registered adapters that consume a design analysis `producerId`
     * produces (#863): those whose `consumes` names one of the producer's
     * `produces` schemas for `unit`. Only registered adapters count, so a
     * development consumer counts only with development adapters on. Whether
     * they are usable is the policy gate's business (usableServiceIds()).
     *
     * @param {string} producerId
     * @param {Object} [options]
     * @param {string} [options.unit="question"] - One of DESIGN_ANALYSIS_UNITS.
     * @returns {string[]} Consumer ids in catalog order; [] for an unknown
     *     producer or one that produces nothing for `unit`.
     */
    getDesignAnalysisConsumerIds(producerId, { unit = "question" } = {}) {
        const schemas = new Set((this.services.get(producerId)?.produces ?? [])
            .filter(item => item.unit === unit)
            .map(item => item.documentSchema));
        if (schemas.size === 0) {
            return [];
        }

        return Array.from(this.services.values())
            .filter(service => (service.consumes ?? [])
                .some(item => item.unit === unit && schemas.has(item.documentSchema)))
            .map(service => service.id);
    }

    /**
     * Whether a consumer needs a design analysis `producerId` produces, in a
     * phase whose stored configuration of the consumer is `configuration`
     * (#870). The consumer's adapter may export
     * `needsDesignAnalysis({ documentSchema, unit, configuration })`; without
     * it, or when it throws, the consumer needs the analysis in every phase
     * that enables it. The catalog's `consumes` still says what it may need.
     *
     * @param {string} consumerId
     * @param {Object} options
     * @param {string} options.producerId
     * @param {string} [options.unit="question"]
     * @param {Object} [options.configuration] - The phase's stored
     *     configuration of the consumer, `{}` when it has none.
     * @returns {boolean} false only when the adapter says so for every schema
     *     the producer produces for `unit` that the consumer consumes.
     */
    consumerNeedsDesignAnalysis(
        consumerId,
        { producerId, unit = "question", configuration = {} } = {}
    ) {
        const needs = this.designAnalysisNeedPredicates.get(consumerId);
        if (!needs) {
            return true;
        }

        const produced = new Set((this.services.get(producerId)?.produces ?? [])
            .filter(item => item.unit === unit)
            .map(item => item.documentSchema));
        const schemas = (this.services.get(consumerId)?.consumes ?? [])
            .filter(item => item.unit === unit && produced.has(item.documentSchema))
            .map(item => item.documentSchema);

        try {
            return schemas.length === 0 || schemas.some(documentSchema => needs({
                documentSchema,
                unit,
                configuration: { ...configuration },
            }) !== false);
        } catch (error) {
            console.warn(`[external-services] needsDesignAnalysis() of ${consumerId} failed; `
                + "the phase is selected.", error?.message || error);
            return true;
        }
    }

    getServiceById(serviceId) {
        return this.services.get(serviceId) || null;
    }

    // Callback callers are authorized for every registered adapter, usable or
    // not; dispatchServiceHook then decides where, if anywhere, the callback
    // may be delivered.
    authorizeCallbackCaller(serviceId, authContext) {
        const service = this.services.get(serviceId);
        if (!service) {
            const error = new Error(`Unknown external service: ${serviceId}`);
            error.statusCode = 404;
            throw error;
        }

        if (!service.callbackAuth || authContext?.disabled === true) {
            return;
        }

        const { allowedClientIds, requiredRoles } = service.callbackAuth;

        if (allowedClientIds.length > 0) {
            const callerClientId = authContext?.clientId || null;
            if (!callerClientId || !allowedClientIds.includes(callerClientId)) {
                const error = new Error(`Caller client id "${callerClientId}" is not authorized to post callbacks for service "${serviceId}".`);
                error.statusCode = 403;
                throw error;
            }
        }

        if (requiredRoles.length > 0) {
            const callerRoles = Array.isArray(authContext?.roles) ? authContext.roles : [];
            const missingRole = requiredRoles.find(role => !callerRoles.includes(role));
            if (missingRole) {
                const error = new Error(`Caller is missing required role "${missingRole}" for service "${serviceId}".`);
                error.statusCode = 403;
                throw error;
            }
        }
    }

    async _dispatchOneHandler({
        hookName, serviceId, handler, context, enabledServiceIds, serviceConfigurations,
        presetJobId = null,
    }) {
        const job = await this._jobsService.createJob({
            id:         presetJobId,
            serviceId,
            hookName,
            sessionId:  context.sessionId  ?? null,
            phaseId:    context.phaseId    ?? null,
            questionId: context.questionId ?? null,
            groupId:    context.groupId    ?? null,
            userId:     context.userId     ?? null,
        }).catch(() => null);

        // A preset id keeps identifying the work even when its job row could
        // not be created.
        const jobId = job?.id ?? presetJobId;

        const serviceContext = {
            ...context,
            serviceId,
            jobId,
            correlationId:        jobId,
            enabledServiceIds:    Array.from(enabledServiceIds),
            serviceConfiguration: serviceConfigurationFor(serviceConfigurations, serviceId),
        };

        if (jobId) {
            await this._jobsService
                .updateJobStatus(jobId, JOB_STATUS.DISPATCHED, { dispatchedAt: new Date().toISOString() })
                .catch(() => null);
        }

        try {
            return await handler(serviceContext, {
                callback: result => this.recordCallbackResult({
                    hookName,
                    serviceId,
                    result,
                    context: serviceContext,
                }),
                reportInstantiation: report => this.recordInstantiationReport({
                    hookName,
                    serviceId,
                    jobId,
                    report,
                    context: serviceContext,
                }),
            });
        } catch (err) {
            if (jobId) {
                await this._jobsService
                    .updateJobStatus(jobId, JOB_STATUS.FAILED)
                    .catch(() => null);
            }
            throw err;
        }
    }

    // The ids among `requestedIds` that pass the policy gate for `hookName`.
    async policyEnabledServiceIds(hookName, context, requestedIds) {
        // Only production adapters depend on the policy, so the version is
        // read only when one of them is requested.
        const needsPolicy = requestedIds
            .some(serviceId => !this.services.get(serviceId).development);
        const policyVersion = needsPolicy
            ? await this.resolveHookPolicyVersion(hookName, context)
            : null;

        return this.effectiveServiceIds(requestedIds, policyVersion);
    }

    // The ids among `requestedIds` that receive an erasure hook
    // (ERASURE_HOOKS): every registered one, whatever the policy, but
    // production adapters only with a usable AI Additions connection.
    async erasureServiceIds(requestedIds = []) {
        const registered = Array.from(new Set(requestedIds))
            .filter(serviceId => this.services.has(serviceId));
        const isDevelopment = serviceId => this.services.get(serviceId).development;
        if (registered.every(isDevelopment) || await this.hasAiAdditionsConnection()) {
            return registered;
        }
        return registered.filter(isDevelopment);
    }

    // Runs the handlers of the effective services among
    // `options.enabledServiceIds` for `hookName`: the policy gate
    // (effectiveServiceIds) drops the others, under the version
    // resolveHookPolicyVersion() picks for the hook (the session's pinned
    // version, or the current one for NON_SESSION_HOOKS). Each handler's context
    // carries `serviceConfiguration`, its entry in
    // `options.serviceConfigurations` (the phase's settings, #734) or {}.
    // `options.jobIds` maps service ids to job ids chosen by the caller, for
    // work it reserved before dispatching. The other services get a new id.
    //
    // phase-ended and activity-finished first close the room jobs they end
    // (closeRoomJobsForHook), before and regardless of the gate.
    async dispatchHook(hookName, context, options = {}) {
        if (!this.initialized) {
            await this.initialize();
        }

        await this.closeRoomJobsForHook(hookName, context);

        const requestedIds = Array.from(new Set(options.enabledServiceIds || []))
            .filter(serviceId => this.services.has(serviceId));
        if (requestedIds.length === 0) {
            return [];
        }

        const enabledServiceIds = new Set(ERASURE_HOOKS.includes(hookName)
            ? await this.erasureServiceIds(requestedIds)
            : await this.policyEnabledServiceIds(hookName, context, requestedIds));
        if (enabledServiceIds.size === 0) {
            return [];
        }

        const jobIds = options.jobIds || {};
        const subscribers = this.hookSubscribers.get(hookName) || [];
        const selectedSubscribers = subscribers.filter(({ serviceId }) => enabledServiceIds.has(serviceId));
        const serviceConfigurations = options.serviceConfigurations || {};

        return Promise.allSettled(selectedSubscribers.map(({ serviceId, handler }) =>
            this._dispatchOneHandler({
                hookName, serviceId, handler, context, enabledServiceIds, serviceConfigurations,
                presetJobId: Object.hasOwn(jobIds, serviceId) ? jobIds[serviceId] : null,
            })
        ));
    }

    /**
     * Closes the live room jobs a lifecycle hook ends (#833), for every
     * service: phase-ended closes those of its phase, activity-finished those
     * of every phase of the session. This is local, adapter-agnostic
     * finalization: it runs before the policy and connection gate and whether
     * or not any adapter receives the hook, so a room job never outlives its
     * phase because its adapter was not usable at that moment. It reads only
     * the database, so it also closes jobs opened before a restart. It is
     * idempotent; a failure is logged, and callbacks still meet the phase
     * check of dispatchServiceHook().
     * @returns {Promise<number>} How many room jobs were closed.
     */
    async closeRoomJobsForHook(hookName, context = {}) {
        const phaseOf = ROOM_JOB_CLOSING_HOOKS[hookName];
        const sessionId = positiveId(context?.sessionId);
        if (!phaseOf || sessionId === null) {
            return 0;
        }

        const phaseId = phaseOf(context);
        if (hookName === "phase-ended" && positiveId(phaseId) === null) {
            return 0;
        }

        try {
            return await this._roomJobsService.closeRoomJobs({
                sessionId,
                phaseId: phaseId === null ? null : positiveId(phaseId),
            });
        } catch (error) {
            console.error(`[external-services] Could not close the room jobs ended by ${hookName}.`, error);
            return 0;
        }
    }

    // Checks that a room job's phase is still the session's active phase and
    // its activity in progress (#833), in case its closure was missed. A room
    // job whose phase is over is closed (best effort) and refused with 409; a
    // failed lookup answers 503 and leaves the result pending.
    async _assertRoomJobPhaseActive(job, serviceId) {
        let state;
        try {
            state = await this._loadPhaseState({
                sessionId: job.sessionId,
                phaseId:   job.phaseId,
                groupId:   job.groupId ?? null,
                userId:    null,
            });
        } catch (error) {
            console.error(`[external-services] Could not read the phase state of a ${serviceId} callback.`, error);
            throw Object.assign(
                new Error("The phase state of the callback could not be read; try again later."),
                { statusCode: 503, code: "callback_lookup_failed" }
            );
        }

        if (!isActivePhaseState(state, job.phaseId)) {
            await this._roomJobsService.closeRoomJob(job.id).catch(error => console.error(
                `[external-services] Could not close a ${serviceId} room job whose phase is over.`, error));
            throw roomJobClosedError(serviceId);
        }
    }

    // Dispatches a design-independent hook to the services that opted into it
    // through `globalHooks` in the manifest. Jobs, correlation ids, callback
    // handling, and error isolation are identical to dispatchHook().
    // `options.serviceIds` narrows the audience to those services, so a
    // caller can dispatch to one service at a time and read its outcome
    // (the user erasure processor, #876).
    async dispatchGlobalHook(hookName, context, { serviceIds = null } = {}) {
        if (!this.initialized) {
            await this.initialize();
        }

        // dispatchHook() applies the policy gate for this hook.
        return this.dispatchHook(hookName, context, {
            enabledServiceIds: this.globalHookServiceIds(hookName)
                .filter(serviceId => serviceIds === null || serviceIds.includes(serviceId)),
        });
    }

    // The ids of the registered services that list `hookName` in
    // `globalHooks`, in catalog order, whether or not they are usable.
    globalHookServiceIds(hookName) {
        return Array.from(this.services.values())
            .filter(service => Array.isArray(service.globalHooks)
                && service.globalHooks.includes(hookName))
            .map(service => service.id);
    }

    // Delivers an inbound callback to its adapter (#815). The destination is
    // decided here, in one place, and handed to the handler as trusted
    // context; the payload's own ids are only a claim:
    //
    // - A callback that matches a job of its service goes to that job's
    //   destination. Its payload may not target anything else
    //   (assertCallbackTargetWithinJob). It completes even after the current
    //   policy removed the service, so work started earlier can finish.
    // - A callback that matches no job (no correlation id, or a fresh one, as
    //   in Polyadic's proactive interventions) goes to the destination its
    //   payload names only when resolveCallbackDestination() verifies it: the
    //   destination session's pinned policy allows the adapter, its phase is
    //   active and enables the adapter, and the group or user belongs to it.
    //   A room bound to an open room job refuses it (409, #833): the room's
    //   callbacks must carry their job.
    // - A room job (#833) accepts repeated callbacks while it is live, and
    //   none once closed (409). A callback outcome never completes it.
    // - A correlation id of another service's job is refused (409), and so is
    //   a destination that fails a check; a failed lookup answers 503. No
    //   handler runs in either case.
    async dispatchServiceHook(hookName, serviceId, context) {
        if (!this.initialized) {
            await this.initialize();
        }

        const service = this.services.get(serviceId);
        if (!service) {
            const error = new Error(`Unknown external service: ${serviceId}`);
            error.statusCode = 404;
            throw error;
        }

        const resultRecord = await this._jobsService.createResult({
            correlationId: context.correlationId ?? null,
            serviceId,
            hookName,
            rawPayload:    context.requestPayload ?? context.rawBody ?? {},
            eventId:       context.eventId    ?? null,
            sessionId:     context.sessionId  ?? null,
            phaseId:       context.phaseId    ?? null,
            questionId:    context.questionId ?? null,
            groupId:       context.groupId    ?? null,
            userId:        context.userId     ?? null,
        }).catch(() => null);

        if (resultRecord?.is_duplicate) {
            return { resultRecord, outcomes: [] };
        }

        // Authorization writes nothing (#815): a transient failure (503)
        // leaves the result pending, so the sender's retry is authorized
        // again. A refusal (409) marks it failed, on a best-effort basis: if
        // that write fails, a retry is simply refused again.
        let job = null;
        let destination;
        try {
            assertCallbackCorrelation(resultRecord, serviceId);

            const resolveTarget = this.callbackTargetResolvers.get(serviceId);
            const target = resolveTarget ? resolveTarget(context.requestPayload ?? {}) : null;

            if (resultRecord.job_id) {
                job = resultRecord.job ?? { id: resultRecord.job_id };
                assertRoomJobLive(job, serviceId);
                assertCallbackTargetWithinJob(job, target, serviceId);
                if (isRoomJob(job)) {
                    await this._assertRoomJobPhaseActive(job, serviceId);
                }
                destination = job;
            } else {
                destination = await this._resolveCallbackDestination({ service, target }, {
                    isAllowedByPolicy:       version => this.isAllowedByPolicy(service, version),
                    policy:                  this._aiServicePolicy,
                    isAiAdditionsConfigured: this._isAiAdditionsConfigured,
                    ...this._callbackDestinationLookups,
                });
                await assertRoomNotBound(this._roomJobsService, serviceId, destination);
            }
        } catch (error) {
            const statusCode = error.statusCode ?? 400;
            if (statusCode !== 503 && resultRecord) {
                await this._jobsService
                    .updateResult(resultRecord.id, { status: RESULT_STATUS.FAILED })
                    .catch(() => null);
            }
            throw error.statusCode ? error : Object.assign(error, { statusCode });
        }

        // Claimed right before any side effect: only one attempt at an event
        // runs its handlers. The others get the duplicate answer.
        let claimed;
        try {
            claimed = await this._jobsService.claimResult(resultRecord);
        } catch (error) {
            // Its room job closed after authorization (#833): refused as above.
            if (error.statusCode === 409) {
                await this._jobsService
                    .updateResult(resultRecord.id, { status: RESULT_STATUS.FAILED })
                    .catch(() => null);
                throw error;
            }
            console.error(`[external-services] Could not claim a ${serviceId} callback.`,
                describeError(error));
            throw Object.assign(
                new Error(`The callback for ${serviceId} could not be recorded; try again later.`),
                { statusCode: 503 }
            );
        }
        if (!claimed) {
            return { resultRecord: { ...resultRecord, is_duplicate: true }, outcomes: [] };
        }

        const subscribers = this.hookSubscribers.get(hookName) || [];
        const selectedSubscribers = subscribers.filter(
            subscriber => subscriber.serviceId === serviceId
        );

        const outcomes = await Promise.allSettled(selectedSubscribers.map(async ({ handler }) => {
            const serviceContext = {
                ...context,
                // The trusted destination: the job's, or the verified one.
                sessionId:            destination.sessionId  ?? null,
                phaseId:              destination.phaseId    ?? null,
                questionId:           destination.questionId ?? null,
                groupId:              destination.groupId    ?? null,
                userId:               destination.userId     ?? null,
                job,
                callbackDestination:  destination,
                serviceId,
                jobId:                resultRecord?.job_id      ?? null,
                resultId:             resultRecord?.id          ?? null,
                isDuplicate:          resultRecord?.is_duplicate ?? false,
                // Callbacks are not tied to a phase design (#734).
                serviceConfiguration: {},
            };

            try {
                return await handler(serviceContext, {
                    callback: result => this.recordCallbackResult({
                        hookName,
                        serviceId,
                        result,
                        context: serviceContext,
                    }),
                });
            } catch (err) {
                if (serviceContext.resultId) {
                    await this._jobsService
                        .updateResult(serviceContext.resultId, { status: RESULT_STATUS.FAILED })
                        .catch(() => null);
                }
                throw err;
            }
        }));

        return { resultRecord, outcomes };
    }

    // Stores on the job what an AI service reported when an adapter created a
    // room or session for it (#737): `{ warnings, degraded,
    // configurationRejected, ...details }`. It does not change the job status.
    // Warnings, degraded mode and rejected settings are also logged.
    async recordInstantiationReport({ hookName, serviceId, jobId, report, context = {} }) {
        const normalized = normalizeInstantiationReport(report);
        if (!normalized) {
            return null;
        }

        if (jobId) {
            const stored = await this._jobsService
                .recordInstantiationReport(jobId, normalized)
                .then(() => true)
                .catch((err) => {
                    console.error("[external-services] Failed to store an instantiation report.",
                        describeError(err));
                    return false;
                });
            if (stored) {
                this._announceInstantiation(serviceId, context);
            }
        }

        const worthLogging = normalized.warnings.length > 0 || normalized.degraded
            || normalized.configurationRejected;
        if (worthLogging) {
            console.warn("[external-services] Instantiation report.", JSON.stringify({
                serviceId,
                hookName,
                jobId:                 jobId ?? null,
                degraded:              normalized.degraded,
                configurationRejected: normalized.configurationRejected,
                warnings:              normalized.warnings,
            }));
        }
        return normalized;
    }

    // Emits `onExternalServiceInstantiated` to the session's teachers (#865):
    // the ids only, so the view reads the stored report through its endpoint.
    _announceInstantiation(serviceId, context) {
        const sessionId = positiveId(context?.sessionId);
        if (sessionId === null) {
            return;
        }

        try {
            this._notifyServiceInstantiated(sessionId, {
                serviceId,
                sessionId,
                phaseId:    positiveId(context.phaseId),
                questionId: positiveId(context.questionId),
            });
        } catch (error) {
            console.error("[external-services] Could not notify teachers of an instantiation.", error);
        }
    }

    async recordCallbackResult({ hookName, serviceId, result, context }) {
        const entry = {
            id:         `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            hookName,
            serviceId,
            receivedAt: new Date().toISOString(),
            result,
            context:    {
                sessionId:      context.sessionId,
                phaseId:        context.phaseId,
                startedPhaseId: context.startedPhaseId,
                endedPhaseId:   context.endedPhaseId,
                userId:         context.userId,
                questionId:     context.questionId,
                groupId:        context.groupId,
                messageId:      context.savedMessage?.id,
            },
        };

        if (context.resultId) {
            const resultStatus = result?.status === "failed"
                ? RESULT_STATUS.FAILED
                : RESULT_STATUS.COMPLETED;
            await this._jobsService
                .updateResult(context.resultId, {
                    status:        resultStatus,
                    adapterResult: result,
                })
                .catch(err => console.error(
                    "[external-services] Failed to persist callback result.", describeError(err)));

            // A room job stays open for the room's next callbacks (#833).
            if (context.jobId && !isRoomJob(context.job)) {
                const jobStatus = result?.status === "failed"
                    ? JOB_STATUS.FAILED
                    : result?.status === "skipped"
                        ? JOB_STATUS.SKIPPED
                        : JOB_STATUS.COMPLETED;
                const completedAt = jobStatus === JOB_STATUS.COMPLETED ? new Date().toISOString() : undefined;
                await this._jobsService
                    .updateJobStatus(context.jobId, jobStatus, { completedAt })
                    .catch(err => console.error(
                        "[external-services] Failed to update job status after callback result.",
                        describeError(err)));
            }
        } else if (context.jobId) {
            const jobStatus = result?.status === "failed"
                ? JOB_STATUS.FAILED
                : result?.status === "skipped"
                    ? JOB_STATUS.SKIPPED
                    : JOB_STATUS.COMPLETED;
            const completedAt = jobStatus === JOB_STATUS.COMPLETED ? new Date().toISOString() : undefined;
            await this._jobsService
                .updateJobStatus(context.jobId, jobStatus, { completedAt })
                .catch(err => console.error("[external-services] Failed to update job status.",
                    describeError(err)));
        }

        // Ids, status and sizes only: the result can carry a student's text
        // (#876, helpers/log-safety.js).
        console.info(
            `[external-services] Callback received from ${serviceId} for ${hookName}.`,
            JSON.stringify(summarizeCallbackResult({ serviceId, hookName, result, context }))
        );
        return entry;
    }

    async publishStudentResult(serviceId, payload) {
        const userId = Number(payload?.userId);

        if (!Number.isInteger(userId) || userId <= 0) {
            console.warn(`[external-services] Cannot publish student result without a valid userId from ${serviceId}.`);
            return false;
        }

        if (!studentNotifications?.externalServiceResult) {
            console.warn("[external-services] Student socket notification service is not initialized.");
            return false;
        }

        studentNotifications.externalServiceResult(userId, {
            ...payload,
            serviceId,
            receivedAt: new Date().toISOString(),
        });

        return true;
    }

    async publishGroupChatMessage(serviceId, payload) {
        const content = typeof payload?.content === "string" ? payload.content.trim() : "";
        const sessionId = Number(payload?.sessionId);
        const phaseId = Number(payload?.phaseId);
        const questionId = Number(payload?.questionId);
        const groupId = Number(payload?.groupId);
        const parentId = payload?.parentId == null ? null : Number(payload.parentId);

        if (!content || !phaseId || !questionId || !groupId) {
            console.warn(`[external-services] Cannot publish chat message with incomplete payload from ${serviceId}.`);
            return null;
        }

        const agent = await this.getOrCreateExternalAgent({
            serviceId,
            displayName: payload?.agentDisplayName,
        });

        if (!agent) {
            console.warn(`[external-services] Cannot resolve chat agent identity for ${serviceId}.`);
            return null;
        }

        const savedMessage = await saveChatMessage({
            userId:          null,
            externalAgentId: agent.id,
            phaseId,
            questionId,
            groupId,
            parentId,
            content,
        });

        if (!savedMessage) {
            console.warn(`[external-services] Chat message from ${serviceId} could not be saved.`);
            return null;
        }

        const notificationPayload = this.normalizeServiceChatNotificationPayload({
            message: savedMessage,
            agent,
            phaseId,
            questionId,
        });
        teacherNotifications?.chatMessage(sessionId, phaseId, questionId, groupId, content);
        teacherNotifications?.groupChatMessage(groupId, {
            ...notificationPayload,
            phaseId,
            questionId,
            groupId,
        });
        studentNotifications?.chatMessage(groupId);

        return {
            savedMessage,
            notificationPayload,
        };
    }

    async getOrCreateExternalAgent({ serviceId, displayName }) {
        const normalizedDisplayName = typeof displayName === "string" && displayName.trim()
            ? displayName.trim()
            : serviceId;

        const rows = await rpg2.execSQL({
            sql: `
                INSERT INTO external_service_agents (service_id, display_name)
                VALUES ($1, $2)
                ON CONFLICT (service_id)
                DO UPDATE
                SET display_name = EXCLUDED.display_name
                RETURNING id, service_id, display_name
            `,
            dbcon:     dbconnString,
            sqlParams: [
                rpg2.param("plain", serviceId),
                rpg2.param("plain", normalizedDisplayName),
            ],
        });

        const agent = rows[0];
        if (!agent) {
            return null;
        }

        return {
            id:          Number(agent.id),
            serviceId:   agent.service_id,
            displayName: agent.display_name,
        };
    }

    normalizeServiceChatNotificationPayload({ message, agent, phaseId, questionId }) {
        return {
            id:                  message.id,
            uid:                 message.uid,
            author_role:         "external_service",
            author_name:         agent.displayName,
            external_service_id: agent.serviceId,
            external_agent_id:   agent.id,
            groupId:             message.tmid,
            phaseId:             message.stageid || phaseId,
            questionId:          message.did || questionId,
            content:             message.content,
            stime:               message.stime,
            parent_id:           message.parent_id,
        };
    }
}

const externalServicesRegistry = new ExternalServicesRegistry();

export default externalServicesRegistry;
