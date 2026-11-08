// The auth pages that emails link to by their bare path are redirected to
// the auth SPA in both NGINX configurations: password recovery
// (/reset-password), and the welcome email of an account created by an
// administrator (#1170: /login, /forgot, /privacy, /terms). dev.conf once
// lacked /terms, so its link reached the session check instead.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CONFIGS, selectLocation, serverLocations } from "./nginx-locations.mjs";

const EMAILED_PAGES = ["/login", "/forgot", "/reset-password", "/privacy", "/terms"];

for (const config of CONFIGS) {
    describe(`${config}: auth pages linked from emails`, () => {
        const locations = serverLocations(config);

        for (const page of EMAILED_PAGES) {
            it(`redirects ${page} to /auth${page}`, () => {
                const location = selectLocation(locations, page);
                assert.ok(location, `no location for ${page}`);
                const redirect = location.directives.find(directive => directive.name === "return");
                assert.ok(redirect, `${page} is not redirected (location ${location.modifier} ${location.pattern})`);
                assert.deepEqual(redirect.args.slice(0, 2), ["302", "/auth$uri$is_args$args"]);
            });
        }
    });
}
