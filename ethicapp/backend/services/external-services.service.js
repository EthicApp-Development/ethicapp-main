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
import { saveChatMessage } from "../helpers/chat-helper.js";
import { studentNotifications, teacherNotifications } from "../config/socket.config.js";
import aiAdditionsClient from "./ai-additions-client.service.js";
import { CapabilityDescriptorsClient } from "./capability-descriptors.service.js";
import {
    externalServiceJobsService,
    JOB_STATUS,
    RESULT_STATUS,
} from "./external-service-jobs.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_MANIFEST_PATH = path.join(__dirname, "../external-services/manifest.json");
const HOOK_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export const SERVICE_SCOPES = Object.freeze(["case", "response", "chat"]);
const UI_LOCALES = Object.freeze(["es_CL", "en_US"]);

const UI_TRANSLATIONS_TIMEOUT_MS = 3000;
const UI_TRANSLATIONS_TTL_MS     = 10 * 60 * 1000;
const UI_TRANSLATIONS_RETRY_MS   = 60 * 1000;

const DEFAULT_CASE_ANALYSES_STORE = Object.freeze({
    markCaseAnalysisProcessing,
    completeCaseAnalysis,
    failCaseAnalysis,
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

// Scopes declare where a service operates: `case` (case documents), `response`
// (student responses) and `chat` (group chat). Screens that list services filter
// by scope instead of guessing from hooks.
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

function normalizeText(value) {
    return typeof value === "string" ? value.trim() : "";
}

const DESCRIPTOR_SERVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

// `descriptor` links a service to the capability descriptor its AI service
// publishes (#687, #725). `serviceId` is the descriptor's `service.id`, which may
// differ from the manifest id: ids are mapped, not renamed, so stored designs and
// jobs keep theirs. `path` is the descriptor route, relative to
// AI_ADDITIONS_BASE_URL: an absolute path without host, query or `..` segments.
function normalizeDescriptor(descriptor, serviceId) {
    if (descriptor === undefined || descriptor === null) {
        return null;
    }

    const descriptorServiceId = normalizeText(descriptor?.serviceId);
    const descriptorPath      = normalizeText(descriptor?.path);
    const isValidPath = descriptorPath.startsWith("/")
        && !descriptorPath.startsWith("//")
        && !/[\s?#\\]/u.test(descriptorPath)
        && !descriptorPath.split("/").includes("..");

    if (!DESCRIPTOR_SERVICE_ID_PATTERN.test(descriptorServiceId) || !isValidPath) {
        console.warn(
            `[external-services] Ignoring invalid descriptor in ${serviceId}: expected `
            + "{ serviceId, path } with an id and an absolute path relative to "
            + "AI_ADDITIONS_BASE_URL."
        );
        return null;
    }

    return { serviceId: descriptorServiceId, path: descriptorPath };
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

export class ExternalServicesRegistry {
    constructor({
        jobsService,
        caseAnalysesStore = DEFAULT_CASE_ANALYSES_STORE,
        now = () => Date.now(),
        uiTranslationsTimeoutMs = UI_TRANSLATIONS_TIMEOUT_MS,
        capabilityDescriptors,
    } = {}) {
        this.initialized      = false;
        this.services         = new Map();
        this.hookSubscribers  = new Map();
        this._jobsService     = jobsService ?? externalServiceJobsService;

        this.uiTranslationProviders   = new Map();
        this.uiTranslationsCache      = new Map();
        this._now                     = now;
        this._uiTranslationsTimeoutMs = uiTranslationsTimeoutMs;

        this.caseAnalysisValidators = new Map();
        this._caseAnalysesStore     = caseAnalysesStore;

        this._capabilityDescriptors = capabilityDescriptors ?? new CapabilityDescriptorsClient({
            getDescriptorLink: serviceId => this.getServiceDescriptor(serviceId),
            requestJson:       (pathname, options) => aiAdditionsClient.requestJson(pathname, options),
            now,
        });
    }

    async initialize(manifestPath = process.env.EXTERNAL_SERVICES_MANIFEST || DEFAULT_MANIFEST_PATH) {
        if (this.initialized) {
            return;
        }

        this.manifestPath = manifestPath;
        const manifest = await this.readManifest(manifestPath);
        const services = Array.isArray(manifest.services) ? manifest.services : [];

        for (const service of services) {
            await this.registerService(service, manifestPath);
        }

        this.initialized = true;
        console.info(`[external-services] Loaded ${this.services.size} service adapter(s).`);
    }

    async readManifest(manifestPath) {
        try {
            const content = await fs.readFile(manifestPath, "utf8");
            return JSON.parse(content);
        } catch (error) {
            console.warn(`[external-services] Manifest could not be loaded from ${manifestPath}.`, error);
            return { services: [] };
        }
    }

    async registerService(service, manifestPath) {
        if (!service?.id || !service?.adapter) {
            console.warn("[external-services] Skipping invalid service manifest entry.", service);
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
            descriptor:   normalizeDescriptor(service.descriptor, service.id),
            enabled:      service.enabled !== false,
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

        if (!normalizedService.enabled) {
            return;
        }

        const adapterUrl = new URL(service.adapter, pathToFileURL(path.resolve(manifestPath)));
        const adapterModule = await import(adapterUrl.href);
        const register = adapterModule.register || adapterModule.default?.register;
        const getUiTranslations = adapterModule.getUiTranslations
            || adapterModule.default?.getUiTranslations;
        const validateCaseAnalysisDocument = adapterModule.validateCaseAnalysisDocument
            || adapterModule.default?.validateCaseAnalysisDocument;

        if (typeof getUiTranslations === "function") {
            this.uiTranslationProviders.set(normalizedService.id, getUiTranslations);
        } else if (normalizedService.scopes.includes("case")) {
            console.warn(
                `[external-services] Adapter ${service.adapter} exports no getUiTranslations(), `
                + `so case screens will show the id of ${normalizedService.id}.`
            );
        }

        if (typeof validateCaseAnalysisDocument === "function") {
            this.caseAnalysisValidators.set(normalizedService.id, validateCaseAnalysisDocument);
        }

        if (typeof register !== "function") {
            console.warn(`[external-services] Adapter ${service.adapter} does not export register().`);
            return;
        }

        const caseAnalyses = createCaseAnalysesAccess(
            this._caseAnalysesStore,
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
            enabled,
        }) => ({
            id,
            description,
            hooks,
            globalHooks,
            scopes,
            ui,
            // Only the descriptor id leaves the registry; the route stays internal.
            descriptor: descriptor ? { serviceId: descriptor.serviceId } : null,
            enabled,
        }));
    }

    // The capability descriptor link of a registered service, or null when it
    // is unknown or declares none.
    getServiceDescriptor(serviceId) {
        const descriptor = this.services.get(serviceId)?.descriptor;
        return descriptor ? { ...descriptor } : null;
    }

    // The normalized instance configuration that an enabled service's capability
    // descriptor advertises, in the descriptor locale for `locale` (#727). Null for
    // unknown or disabled services and for services without a descriptor;
    // `{ available: false, reason }` when the descriptor cannot be fetched.
    async getServiceInstanceConfiguration(serviceId, locale) {
        if (!this.services.get(serviceId)?.enabled) {
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

    getGloballyEnabledServiceIds(hookName) {
        return Array.from(this.services.values())
            .filter(service => service.enabled
                && Array.isArray(service.globalHooks)
                && service.globalHooks.includes(hookName))
            .map(service => service.id);
    }

    getEnabledServiceIdsForScope(scope) {
        return Array.from(this.services.values())
            .filter(service => service.enabled
                && Array.isArray(service.scopes)
                && service.scopes.includes(scope))
            .map(service => service.id);
    }

    // The adapter's optional validateCaseAnalysisDocument(), which checks
    // teacher edits of its analyses, or null when it accepts none.
    getCaseAnalysisValidator(serviceId) {
        return this.caseAnalysisValidators.get(serviceId) || null;
    }

    getServiceById(serviceId) {
        return this.services.get(serviceId) || null;
    }

    hasEnabledService(serviceId) {
        const service = this.services.get(serviceId);
        return Boolean(service?.enabled);
    }

    authorizeCallbackCaller(serviceId, authContext) {
        const service = this.services.get(serviceId);
        if (!service?.enabled) {
            const error = new Error(`Unknown or disabled external service: ${serviceId}`);
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
        hookName,
        serviceId,
        handler,
        context,
        enabledServiceIds,
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
            correlationId:     jobId,
            enabledServiceIds: Array.from(enabledServiceIds),
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

    // `options.jobIds` maps service ids to job ids chosen by the caller, for
    // work it reserved before dispatching. The other services get a new id.
    async dispatchHook(hookName, context, options = {}) {
        if (!this.initialized) {
            await this.initialize();
        }

        const enabledServiceIds = new Set(options.enabledServiceIds || []);
        if (enabledServiceIds.size === 0) {
            return [];
        }

        const jobIds = options.jobIds || {};
        const subscribers = this.hookSubscribers.get(hookName) || [];
        const selectedSubscribers = subscribers.filter(({ serviceId }) => enabledServiceIds.has(serviceId));

        return Promise.allSettled(selectedSubscribers.map(({ serviceId, handler }) =>
            this._dispatchOneHandler({
                hookName,
                serviceId,
                handler,
                context,
                enabledServiceIds,
                presetJobId: Object.hasOwn(jobIds, serviceId) ? jobIds[serviceId] : null,
            })
        ));
    }

    // Dispatches a design-independent hook to the services that opted into it
    // through `globalHooks` in the manifest. Jobs, correlation ids, callback
    // handling, and error isolation are identical to dispatchHook().
    async dispatchGlobalHook(hookName, context) {
        if (!this.initialized) {
            await this.initialize();
        }

        return this.dispatchHook(hookName, context, {
            enabledServiceIds: this.getGloballyEnabledServiceIds(hookName),
        });
    }

    async dispatchServiceHook(hookName, serviceId, context) {
        if (!this.initialized) {
            await this.initialize();
        }

        if (!this.hasEnabledService(serviceId)) {
            const error = new Error(`Unknown or disabled external service: ${serviceId}`);
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

        const subscribers = this.hookSubscribers.get(hookName) || [];
        const selectedSubscribers = subscribers.filter(
            subscriber => subscriber.serviceId === serviceId
        );

        const outcomes = await Promise.allSettled(selectedSubscribers.map(async ({ handler }) => {
            const serviceContext = {
                ...context,
                serviceId,
                jobId:       resultRecord?.job_id      ?? null,
                resultId:    resultRecord?.id          ?? null,
                isDuplicate: resultRecord?.is_duplicate ?? false,
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
                .catch(err => console.error("[external-services] Failed to persist callback result.", err));

            if (context.jobId) {
                const jobStatus = result?.status === "failed"
                    ? JOB_STATUS.FAILED
                    : result?.status === "skipped"
                        ? JOB_STATUS.SKIPPED
                        : JOB_STATUS.COMPLETED;
                const completedAt = jobStatus === JOB_STATUS.COMPLETED ? new Date().toISOString() : undefined;
                await this._jobsService
                    .updateJobStatus(context.jobId, jobStatus, { completedAt })
                    .catch(err => console.error("[external-services] Failed to update job status after callback result.", err));
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
                .catch(err => console.error("[external-services] Failed to update job status.", err));
        }

        console.info(`[external-services] Callback received from ${serviceId} for ${hookName}.`, entry);
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
