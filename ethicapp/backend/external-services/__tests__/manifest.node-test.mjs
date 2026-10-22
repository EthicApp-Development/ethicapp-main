import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
    ExternalServicesRegistry,
    SERVICE_SCOPES,
} from "../../services/external-services.service.js";

const manifestUrl = new URL("../manifest.json", import.meta.url);
const manifest = JSON.parse(await fs.readFile(manifestUrl, "utf8"));

// Screens list services by scope, so an entry without one would silently
// disappear from them.
test("manifest: every service declares at least one known scope", () => {
    for (const service of manifest.services) {
        assert.ok(
            Array.isArray(service.scopes) && service.scopes.length > 0,
            `${service.id} declares no scopes`
        );

        for (const scope of service.scopes) {
            assert.ok(
                SERVICE_SCOPES.includes(scope),
                `${service.id} declares unknown scope "${scope}"`
            );
        }
    }
});

// Case screens show each case-scoped service by its translated texts.
test("manifest: every case-scoped service provides UI translations", async () => {
    const registry     = new ExternalServicesRegistry({ jobsService: {} });
    const caseServices = manifest.services.filter(service => service.scopes?.includes("case"));

    for (const service of caseServices) {
        await registry.registerService({ ...service, enabled: true }, fileURLToPath(manifestUrl));

        assert.ok(
            await registry.getServiceUiTranslations(service.id),
            `${service.id} provides no valid es_CL and en_US translations`
        );
    }
});

// The AI services publish their configuration through capability descriptors,
// under ids that differ from the manifest ids (#725).
test("manifest: AI services declare their capability descriptor", async () => {
    const registry = new ExternalServicesRegistry({ jobsService: {} });
    const expected = {
        "polyadic-devils-advocate": {
            serviceId: "polyadic-agent",
            path:      "/polyadic-agent/api/capabilities",
        },
        "argumentation-tutor-system": {
            serviceId: "argumentation-tutor",
            path:      "/argumentation-tutor/api/capabilities",
        },
    };

    for (const service of manifest.services) {
        await registry.registerService({ ...service, enabled: false }, fileURLToPath(manifestUrl));
        assert.deepEqual(
            registry.getServiceDescriptor(service.id),
            expected[service.id] ?? null,
            service.id,
        );
    }
});
