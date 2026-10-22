import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ExternalServicesCatalogService } from "../external-services-catalog.service.js";

function createService(result = [{ id: "svc-a" }], { uiLanguage = "es_CL" } = {}) {
    const requests = [];
    const language = { current: uiLanguage };
    const $http = {
        get: async (url, config) => {
            requests.push({ url, config });
            return { data: { status: "ok", result } };
        }
    };
    const languageCatalog = { getCurrentUiLanguageCode: () => language.current };

    return {
        service: ExternalServicesCatalogService($http, languageCatalog),
        requests,
        language,
    };
}

describe("ExternalServicesCatalogService", () => {
    it("requests the given scopes in the UI language and returns the listed services", async () => {
        const { service, requests } = createService();

        const services = await service.getServices({ scopes: ["response", "chat"] });

        assert.deepEqual(services, [{ id: "svc-a" }]);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].url, "/external-services");
        assert.deepEqual(requests[0].config.params, {
            scope:  ["response", "chat"],
            locale: "es_CL",
        });
    });

    it("defaults to an empty scope list", async () => {
        const { service, requests } = createService();

        await service.getServices();

        assert.deepEqual(requests[0].config.params, { scope: [], locale: "es_CL" });
    });

    it("caches each set of scopes separately until a reload", async () => {
        const { service, requests } = createService();

        await service.getServices({ scopes: ["response", "chat"] });
        await service.getServices({ scopes: ["response", "chat"] });
        await service.getServices({ scopes: ["case"] });
        await service.getServices({ scopes: ["case"], reload: true });

        assert.deepEqual(requests.map(({ config }) => config.params.scope), [
            ["response", "chat"],
            ["case"],
            ["case"]
        ]);
    });

    it("keys the cache by UI language, so a language switch asks again", async () => {
        const { service, requests, language } = createService();

        await service.getServices({ scopes: ["chat"] });
        language.current = "en_US";
        await service.getServices({ scopes: ["chat"] });
        await service.getServices({ scopes: ["chat"] });
        language.current = "es_CL";
        await service.getServices({ scopes: ["chat"] });

        assert.deepEqual(requests.map(({ config }) => config.params.locale), ["es_CL", "en_US"]);
    });

    it("falls back to English without a language catalog", async () => {
        const requests = [];
        const service = ExternalServicesCatalogService({
            get: async (url, config) => {
                requests.push(config);
                return { data: { status: "ok", result: [] } };
            }
        });

        await service.getServices();

        assert.equal(requests[0].params.locale, "en_US");
    });

    it("rejects a response without a service list", async () => {
        const service = ExternalServicesCatalogService({
            get: async () => ({ data: { status: "err" } })
        });

        await assert.rejects(service.getServices(), /Unexpected external services response format/);
    });

    it("requests a service's instance configuration in the UI language", async () => {
        const configuration = { serviceId: "svc/a", available: true, fields: [] };
        const { service, requests, language } = createService(configuration);
        language.current = "en_US";

        const result = await service.getInstanceConfiguration("svc/a");

        assert.deepEqual(result, configuration);
        assert.equal(requests[0].url, "/external-services/svc%2Fa/instance-configuration");
        assert.deepEqual(requests[0].config.params, { locale: "en_US" });
    });

    it("asks for the instance configuration every time", async () => {
        const { service, requests } = createService({ available: false, reason: "unreachable" });

        await service.getInstanceConfiguration("svc-a");
        await service.getInstanceConfiguration("svc-a");

        assert.equal(requests.length, 2, "the backend owns the descriptor cache");
    });

    it("rejects an unexpected instance configuration response", async () => {
        const service = ExternalServicesCatalogService({
            get: async () => ({ data: { status: "err" } })
        });

        await assert.rejects(service.getInstanceConfiguration("svc-a"),
            /Unexpected instance configuration response format/);
    });
});
