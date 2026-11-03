// The last URL of the Cases page, for the case view's "← Cases" (#1018).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    CasesListLocationService,
    casesListUrlOf,
    trackCasesListLocation,
} from "../cases-list-location.service.js";

describe("casesListUrlOf", () => {
    it("keeps the Cases page's URL with its search, without a hash", () => {
        assert.equal(casesListUrlOf("/cases"), "/cases");
        assert.equal(casesListUrlOf("/cases?tab=shared&q=salud"), "/cases?tab=shared&q=salud");
        assert.equal(casesListUrlOf("/cases?status=in-use#top"), "/cases?status=in-use");
    });

    it("ignores every other page", () => {
        assert.equal(casesListUrlOf("/cases/7"), null);
        assert.equal(casesListUrlOf("/cases/new?tab=shared"), null);
        assert.equal(casesListUrlOf("/designs"), null);
        assert.equal(casesListUrlOf(undefined), null);
    });
});

describe("CasesListLocationService", () => {
    it("falls back to the list", () => {
        const service = CasesListLocationService();
        assert.equal(service.lastUrl(), "/cases");
        assert.equal(service.lastHref(), "#!/cases");
    });

    it("follows the route events of the Cases page only", () => {
        const handlers = {};
        const $rootScope = { $on: (name, handler) => (handlers[name] = handler) };
        let url = "/cases?tab=archived";
        const $location = { url: () => url };
        const service = CasesListLocationService();
        trackCasesListLocation($rootScope, $location, service);

        handlers.$routeChangeSuccess();
        assert.equal(service.lastHref(), "#!/cases?tab=archived");

        // A tab or filter change does not reload the page: a route update.
        url = "/cases?tab=archived&q=privacidad";
        handlers.$routeUpdate();
        assert.equal(service.lastUrl(), "/cases?tab=archived&q=privacidad");

        url = "/cases/7";
        handlers.$routeChangeSuccess();
        assert.equal(service.lastUrl(), "/cases?tab=archived&q=privacidad");
    });
});
