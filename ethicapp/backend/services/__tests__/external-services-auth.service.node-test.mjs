import assert from "node:assert/strict";
import test from "node:test";
import externalServicesRegistry from "../external-services.service.js";

function registerTestService(id, callbackAuth = null) {
    externalServicesRegistry.services.set(id, {
        id,
        description: "test service",
        hooks: ["callback-received"],
        requires: ["polyadic-agent"],
        adapter: "./test-adapter.js",
        callbackAuth,
    });
}

test("authorizeCallbackCaller: throws 404 for unknown service", () => {
    assert.throws(
        () => externalServicesRegistry.authorizeCallbackCaller("unknown-xyz", { clientId: "any", roles: [] }),
        err => err.statusCode === 404
    );
});

test("authorizeCallbackCaller: allows any caller when callbackAuth is not configured", () => {
    registerTestService("test-no-auth");
    assert.doesNotThrow(() =>
        externalServicesRegistry.authorizeCallbackCaller("test-no-auth", { clientId: "any-client", roles: [] })
    );
});

test("authorizeCallbackCaller: skips authorization when auth is disabled (callbackAuth-protected service)", () => {
    registerTestService("test-disabled-auth", { allowedClientIds: ["specific-client"], requiredRoles: [] });
    assert.doesNotThrow(() =>
        externalServicesRegistry.authorizeCallbackCaller("test-disabled-auth", { disabled: true })
    );
});

test("authorizeCallbackCaller: allows matching clientId", () => {
    registerTestService("test-allowed-client", { allowedClientIds: ["polyadic-agent-api"], requiredRoles: [] });
    assert.doesNotThrow(() =>
        externalServicesRegistry.authorizeCallbackCaller("test-allowed-client", { clientId: "polyadic-agent-api", roles: [] })
    );
});

test("authorizeCallbackCaller: throws 403 when caller client not in allowedClientIds", () => {
    registerTestService("test-restricted-client", { allowedClientIds: ["allowed-client"], requiredRoles: [] });
    assert.throws(
        () => externalServicesRegistry.authorizeCallbackCaller("test-restricted-client", { clientId: "other-client", roles: [] }),
        err => err.statusCode === 403
    );
});

test("authorizeCallbackCaller: throws 403 when required realm role is missing", () => {
    registerTestService("test-required-role", { allowedClientIds: [], requiredRoles: ["editor"] });
    assert.throws(
        () => externalServicesRegistry.authorizeCallbackCaller("test-required-role", { clientId: "any-client", roles: ["viewer"] }),
        err => err.statusCode === 403
    );
});

test("authorizeCallbackCaller: allows caller with required realm role", () => {
    registerTestService("test-role-ok", { allowedClientIds: [], requiredRoles: ["editor"] });
    assert.doesNotThrow(() =>
        externalServicesRegistry.authorizeCallbackCaller("test-role-ok", { clientId: "any-client", roles: ["viewer", "editor"] })
    );
});

test("listServices does not expose the removed capabilities key", () => {
    externalServicesRegistry.services.set("test-response-processor", {
        id:           "test-response-processor",
        description:  "test service",
        hooks:        ["student-response-submitted"],
        scopes:       ["response"],
        capabilities: { processesStudentResponses: true },
        requires:     ["polyadic-agent"],
        adapter:      "./test-adapter.js",
        callbackAuth: null,
    });

    const service = externalServicesRegistry
        .listServices()
        .find(({ id }) => id === "test-response-processor");

    assert.deepEqual(service?.scopes, ["response"]);
    assert.equal(Object.hasOwn(service, "capabilities"), false);
});
