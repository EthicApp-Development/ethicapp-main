import fs from "fs/promises";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { dbconnString } from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import { saveChatMessage } from "../helpers/chat-helper.js";
import { studentNotifications, teacherNotifications } from "../config/socket.config.js";
import aiAdditionsClient from "./ai-additions-client.service.js";
import {
    externalServiceJobsService,
    JOB_STATUS,
    RESULT_STATUS,
} from "./external-service-jobs.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_MANIFEST_PATH = path.join(__dirname, "../external-services/manifest.json");
const HOOK_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

function isValidHookName(hookName) {
    return typeof hookName === "string" && HOOK_NAME_PATTERN.test(hookName);
}

export class ExternalServicesRegistry {
    constructor({ jobsService } = {}) {
        this.initialized      = false;
        this.services         = new Map();
        this.hookSubscribers  = new Map();
        this.results          = [];
        this._jobsService     = jobsService ?? externalServiceJobsService;
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

        const normalizedService = {
            id: service.id,
            description: service.description || "",
            hooks: Array.isArray(service.hooks)
                ? service.hooks.filter(hookName => {
                    const isValid = isValidHookName(hookName);
                    if (!isValid) {
                        console.warn(`[external-services] Ignoring non-kebab-case hook "${hookName}" in ${service.id}.`);
                    }
                    return isValid;
                })
                : [],
            enabled: service.enabled !== false,
            adapter: service.adapter,
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

        if (typeof register !== "function") {
            console.warn(`[external-services] Adapter ${service.adapter} does not export register().`);
            return;
        }

        await register({
            service: normalizedService,
            subscribe: (hookName, handler) => {
                this.subscribe(normalizedService.id, hookName, handler);
            },
            publishStudentResult: payload => this.publishStudentResult(normalizedService.id, payload),
            publishGroupChatMessage: payload => this.publishGroupChatMessage(normalizedService.id, payload),
            aiAdditionsClient,
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
        return Array.from(this.services.values()).map(({ id, description, hooks, enabled }) => ({
            id,
            description,
            hooks,
            enabled,
        }));
    }

    listResults() {
        return this.results.slice(-100);
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

    async _dispatchOneHandler({ hookName, serviceId, handler, context, enabledServiceIds }) {
        const job = await this._jobsService.createJob({
            serviceId,
            hookName,
            sessionId:  context.sessionId  ?? null,
            phaseId:    context.phaseId    ?? null,
            questionId: context.questionId ?? null,
            groupId:    context.groupId    ?? null,
            userId:     context.userId     ?? null,
        }).catch(() => null);

        const jobId = job?.id ?? null;

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

    async dispatchHook(hookName, context, options = {}) {
        if (!this.initialized) {
            await this.initialize();
        }

        const enabledServiceIds = new Set(options.enabledServiceIds || []);
        if (enabledServiceIds.size === 0) {
            return [];
        }

        const subscribers = this.hookSubscribers.get(hookName) || [];
        const selectedSubscribers = subscribers.filter(({ serviceId }) => enabledServiceIds.has(serviceId));

        return Promise.allSettled(selectedSubscribers.map(({ serviceId, handler }) =>
            this._dispatchOneHandler({ hookName, serviceId, handler, context, enabledServiceIds })
        ));
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
            sessionId:     context.sessionId  ?? null,
            phaseId:       context.phaseId    ?? null,
            questionId:    context.questionId ?? null,
            groupId:       context.groupId    ?? null,
            userId:        context.userId     ?? null,
        }).catch(() => null);

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
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            hookName,
            serviceId,
            receivedAt: new Date().toISOString(),
            result,
            context: {
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

        this.results.push(entry);
        if (this.results.length > 100) {
            this.results.shift();
        }

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
            userId: null,
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
            dbcon: dbconnString,
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
            id: Number(agent.id),
            serviceId: agent.service_id,
            displayName: agent.display_name,
        };
    }

    normalizeServiceChatNotificationPayload({ message, agent, phaseId, questionId }) {
        return {
            id: message.id,
            uid: message.uid,
            author_role: "external_service",
            author_name: agent.displayName,
            external_service_id: agent.serviceId,
            external_agent_id: agent.id,
            groupId: message.tmid,
            phaseId: message.stageid || phaseId,
            questionId: message.did || questionId,
            content: message.content,
            stime: message.stime,
            parent_id: message.parent_id,
        };
    }
}

const externalServicesRegistry = new ExternalServicesRegistry();

export default externalServicesRegistry;
