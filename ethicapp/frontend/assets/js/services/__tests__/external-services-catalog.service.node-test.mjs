import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ExternalServicesCatalogService } from "../external-services-catalog.service.js";

function createService(result = [{ id: "svc-a" }]) {
    const requests = [];
    const $http = {
        get: async (url, config) => {
            requests.push({ url, config });
            return { data: { status: "ok", result } };
        }
    };

    return { service: ExternalServicesCatalogService($http), requests };
}

describe("ExternalServicesCatalogService", () => {
    it("requests the given scopes and returns the listed services", async () => {
        const { service, requests } = createService();

        const services = await service.getServices({ scopes: ["response", "chat"] });

        assert.deepEqual(services, [{ id: "svc-a" }]);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].url, "/external-services");
        assert.deepEqual(requests[0].config.params, { scope: ["response", "chat"] });
    });

    it("defaults to an empty scope list", async () => {
        const { service, requests } = createService();

        await service.getServices();

        assert.deepEqual(requests[0].config.params, { scope: [] });
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

    it("rejects a response without a service list", async () => {
        const service = ExternalServicesCatalogService({
            get: async () => ({ data: { status: "err" } })
        });

        await assert.rejects(service.getServices(), /Unexpected external services response format/);
    });
});
