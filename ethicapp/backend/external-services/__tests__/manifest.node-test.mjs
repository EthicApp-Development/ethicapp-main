import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { SERVICE_SCOPES } from "../../services/external-services.service.js";

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
