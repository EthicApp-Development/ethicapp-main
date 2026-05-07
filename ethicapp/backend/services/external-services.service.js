import fs from "fs/promises";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

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

    async recordCallbackResult({ hookName, serviceId, result, context }) {
        const entry = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            hookName,
            serviceId,
            receivedAt: new Date().toISOString(),
            result,
            context: {
                sessionId: context.sessionId,
                phaseId: context.phaseId,
                startedPhaseId: context.startedPhaseId,
                endedPhaseId: context.endedPhaseId,
                userId: context.userId,
                questionId: context.questionId,
            },
        };

        this.results.push(entry);
        if (this.results.length > 100) {
            this.results.shift();
        }

        console.info(`[external-services] Callback received from ${serviceId} for ${hookName}.`, entry);
        return entry;
    }
}

const externalServicesRegistry = new ExternalServicesRegistry();

export default externalServicesRegistry;
