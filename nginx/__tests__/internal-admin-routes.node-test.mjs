// Proves that ethicapp's internal-only /api/admin/ routes are not served at
// the edge (#816): for both NGINX configurations, the location NGINX selects
// for each of them, in any letter case, is one of the two blocking locations
// (`^~ /api/admin/` and `~* ^/api/admin/`), which return 404 without
// proxying. Location selection follows NGINX's rules: an exact match wins;
// otherwise the longest prefix, which stops the search when it is `^~`;
// otherwise the first matching regex in file order; otherwise that longest
// prefix. Prefix and exact matches are case-sensitive; `~*` regexes are not.
// auth-backend's internal admin routes under /api/auth/admin/users/ (#889)
// get the same check.
//
// `npm run test:nginx-edge` checks the same thing against a running NGINX.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CONFIGS, matches, selectLocation, serverLocations } from "./nginx-locations.mjs";

const INTERNAL_ROUTES = [
    "/api/admin/ai-services/catalog",
    "/api/admin/ai-services/connection-test",
    "/api/admin/ai-services/",
    "/api/admin/impersonation/professor/12",
    "/api/admin/user-erasure/users/12",
    "/api/admin/user-erasure/users/12/retry",
    "/api/admin/users/12/open-activities",
    "/api/admin/users/12/finish-activities",
];

// Spellings that a case-insensitive router would accept.
function caseVariants(uri) {
    return [
        uri.toUpperCase(),
        uri.replace("/api/", "/API/"),
        uri.replace("/admin/", "/Admin/"),
        uri.replace("/ai-services/", "/AI-Services/")
            .replace("/impersonation/", "/Impersonation/")
            .replace("/user-erasure/", "/User-Erasure/")
            .replace("/users/", "/Users/"),
    ].filter(variant => variant !== uri);
}

const STOP_PATH = "/api/admin/impersonation/stop";

describe("internal /api/admin/ routes at the NGINX edge", () => {
    for (const config of CONFIGS) {
        describe(config, () => {
            const locations = serverLocations(config);
            const blockingPrefix = locations.find(location => location.modifier === "^~"
                && location.pattern === "/api/admin/");
            const blockingRegex = locations.find(location => location.modifier === "~*"
                && location.pattern === "^/api/admin/");

            for (const [label, blocking] of [
                ["^~ /api/admin/", blockingPrefix],
                ["~* ^/api/admin/", blockingRegex],
            ]) {
                it(`has a blocking \`location ${label}\` that answers 404 without proxying`, () => {
                    assert.ok(blocking, `missing \`location ${label}\``);
                    const names = blocking.directives.map(directive => directive.name);
                    assert.ok(
                        blocking.directives.some(directive => directive.name === "return"
                            && directive.args[0] === "404"),
                        "the location must `return 404`"
                    );
                    for (const forbidden of [
                        "proxy_pass", "fastcgi_pass", "uwsgi_pass", "grpc_pass", "alias", "root",
                    ]) {
                        assert.equal(names.includes(forbidden), false, `must not use ${forbidden}`);
                    }
                });
            }

            for (const uri of INTERNAL_ROUTES) {
                it(`blocks ${uri}`, () => {
                    assert.equal(selectLocation(locations, uri), blockingPrefix);
                });

                it(`blocks other spellings of ${uri}`, () => {
                    for (const variant of caseVariants(uri)) {
                        // `/api/admin/` itself spelled in lower case stays on the prefix.
                        const expected = variant.startsWith("/api/admin/")
                            ? blockingPrefix
                            : blockingRegex;
                        assert.equal(selectLocation(locations, variant), expected, variant);
                    }
                });
            }

            it("tries the case-insensitive block before any other regex that could match", () => {
                const regexes = locations.filter(location => location.modifier.startsWith("~"));
                for (const uri of INTERNAL_ROUTES.flatMap(caseVariants)) {
                    assert.equal(regexes.find(location => matches(location, uri)), blockingRegex, uri);
                }
            });

            it("keeps impersonation stop as the only /api/admin/ exception", () => {
                const exceptions = locations
                    .filter(location => location !== blockingPrefix && location !== blockingRegex
                        && location.pattern.toLowerCase().includes("/api/admin"))
                    .map(location => `${location.modifier} ${location.pattern}`);
                assert.deepEqual(exceptions, [`= ${STOP_PATH}`]);

                const stop = selectLocation(locations, STOP_PATH);
                assert.equal(stop.modifier, "=");
                assert.ok(stop.directives.some(directive => directive.name === "proxy_pass"));
            });
        });
    }

    // auth-backend's internal admin routes (#889), which only
    // management-console calls. Express matches routes regardless of letter
    // case, so every spelling must stop at the edge.
    const AUTH_INTERNAL_ROUTES = [
        "/api/auth/admin/users/12/password",
        "/api/auth/admin/users/",
    ];
    const AUTH_PUBLIC_ROUTES = [
        "/api/auth/login",
        "/api/auth/password-policy",
        "/api/auth/admin/verify-password",
        "/api/auth/admin/password-reset",
    ];

    function authCaseVariants(uri) {
        return [
            uri.toUpperCase(),
            uri.replace("/api/", "/API/"),
            uri.replace("/auth/", "/Auth/"),
            uri.replace("/admin/", "/Admin/"),
            uri.replace("/users/", "/Users/"),
            uri.replace("/password", "/Password"),
        ].filter(variant => variant !== uri);
    }

    for (const config of CONFIGS) {
        describe(`${config}: auth-backend internal routes`, () => {
            const locations = serverLocations(config);
            const blockingPrefix = locations.find(location => location.modifier === "^~"
                && location.pattern === "/api/auth/admin/users/");
            const blockingRegex = locations.find(location => location.modifier === "~*"
                && location.pattern === "^/api/auth/admin/users/");
            const authApi = locations.find(location => location.modifier === ""
                && location.pattern === "/api/auth/");

            for (const [label, blocking] of [
                ["^~ /api/auth/admin/users/", blockingPrefix],
                ["~* ^/api/auth/admin/users/", blockingRegex],
            ]) {
                it(`has a blocking \`location ${label}\` that answers 404 without proxying`, () => {
                    assert.ok(blocking, `missing \`location ${label}\``);
                    const names = blocking.directives.map(directive => directive.name);
                    assert.ok(blocking.directives.some(directive => directive.name === "return"
                        && directive.args[0] === "404"));
                    for (const forbidden of [
                        "proxy_pass", "fastcgi_pass", "uwsgi_pass", "grpc_pass", "alias", "root",
                    ]) {
                        assert.equal(names.includes(forbidden), false, `must not use ${forbidden}`);
                    }
                });
            }

            for (const uri of AUTH_INTERNAL_ROUTES) {
                it(`blocks ${uri} in any letter case`, () => {
                    assert.equal(selectLocation(locations, uri), blockingPrefix);
                    for (const variant of authCaseVariants(uri)) {
                        const expected = variant.startsWith("/api/auth/admin/users/")
                            ? blockingPrefix
                            : blockingRegex;
                        assert.equal(selectLocation(locations, variant), expected, variant);
                    }
                });
            }

            it("tries the case-insensitive block before any other regex that could match", () => {
                const regexes = locations.filter(location => location.modifier.startsWith("~"));
                for (const uri of AUTH_INTERNAL_ROUTES.flatMap(authCaseVariants)) {
                    assert.equal(regexes.find(location => matches(location, uri)), blockingRegex, uri);
                }
            });

            it("keeps proxying the rest of the auth API", () => {
                assert.ok(authApi, "missing `location /api/auth/`");
                for (const uri of AUTH_PUBLIC_ROUTES) {
                    assert.equal(selectLocation(locations, uri), authApi, uri);
                }
            });
        });
    }

    it("selects locations the way NGINX does", () => {
        const locations = [
            { modifier: "", pattern: "/" },
            { modifier: "", pattern: "/api/" },
            { modifier: "^~", pattern: "/static/" },
            { modifier: "~", pattern: "^/api/.+\\.png$" },
            { modifier: "~*", pattern: "^/api/.+\\.(png|jpg)$" },
            { modifier: "~*", pattern: "^/other/" },
            { modifier: "=", pattern: "/api/exact" },
        ];
        const pick = uri => selectLocation(locations, uri).pattern;

        assert.equal(pick("/api/exact"), "/api/exact");
        assert.equal(pick("/API/exact"), "/");
        assert.equal(pick("/api/x.png"), "^/api/.+\\.png$");
        assert.equal(pick("/api/x.jpg"), "^/api/.+\\.(png|jpg)$");
        assert.equal(pick("/static/x.png"), "/static/");
        assert.equal(pick("/STATIC/x.txt"), "/");
        assert.equal(pick("/api/x"), "/api/");
        assert.equal(pick("/OTHER/x"), "^/other/");
        assert.equal(pick("/elsewhere"), "/");
    });
});
