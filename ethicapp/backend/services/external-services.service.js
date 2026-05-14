import fs from "fs/promises";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import * as config from "../config/config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import { saveChatMessage } from "../helpers/chat-helper.js";
import { studentNotifications, teacherNotifications } from "../config/socket.config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_MANIFEST_PATH = path.join(__dirname, "../external-services/manifest.json");

class ExternalServicesRegistry {
    constructor() {
        this.initialized = false;
        this.services = new Map();
        this.hookSubscribers = new Map();
        this.results = [];
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
            hooks: Array.isArray(service.hooks) ? service.hooks : [],
            enabled: service.enabled !== false,
            adapter: service.adapter,
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
        });
    }

    subscribe(serviceId, hookName, handler) {
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

    hasEnabledService(serviceId) {
        const service = this.services.get(serviceId);
        return Boolean(service?.enabled);
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

        return Promise.allSettled(selectedSubscribers.map(({ serviceId, handler }) => {
            const serviceContext = {
                ...context,
                serviceId,
                enabledServiceIds: Array.from(enabledServiceIds),
            };

            return handler(serviceContext, {
                callback: result => this.recordCallbackResult({
                    hookName,
                    serviceId,
                    result,
                    context: serviceContext,
                }),
            });
        }));
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

        const subscribers = this.hookSubscribers.get(hookName) || [];
        const selectedSubscribers = subscribers.filter(
            subscriber => subscriber.serviceId === serviceId
        );

        return Promise.allSettled(selectedSubscribers.map(({ handler }) => {
            const serviceContext = {
                ...context,
                serviceId,
            };

            return handler(serviceContext, {
                callback: result => this.recordCallbackResult({
                    hookName,
                    serviceId,
                    result,
                    context: serviceContext,
                }),
            });
        }));
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
            dbcon: config.dbconnString,
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
