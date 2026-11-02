// An activity's AI services switch (#970): the launch request's parsing, the
// gate where a session's services are read (designs-helper.js) and what it
// does to the hook dispatch, and the launch notice it skips. PostgreSQL is
// replaced by a fake pg pool.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import {
    launchAiServicesEnabled,
    noPhaseExternalServices,
    sessionAiServicesEnabled,
} from "../session-ai-services.js";
import {
    PHASE_SESSION_AI_SERVICES_SQL,
    SESSION_ACTIVITY_DESIGN_SQL,
    getEnabledExternalServiceIdsBySessionId,
    getPhaseExternalServices,
} from "../designs-helper.js";
import { dispatchPhaseHook } from "../external-service-dispatch.js";
import { servicesNotRunningAtLaunch } from "../ai-service-launch-notice.js";
import { installFakePgPool } from "../../controllers/__tests__/fake-pg-pool.mjs";

const SESSION_ON = 10;
const SESSION_OFF = 20;
const PHASE_ON = 100;
const PHASE_OFF = 200;
const DESIGN_ID = 7;

const DESIGN = {
    phases: [{
        externalServices: {
            enabledServiceIds: ["reviewer"],
            configurations:    { reviewer: { tone: "kind" } },
        },
    }],
};

const switches = new Map([[SESSION_ON, true], [SESSION_OFF, false]]);
const phases = new Map([[PHASE_ON, SESSION_ON], [PHASE_OFF, SESSION_OFF]]);

const db = installFakePgPool((sql, params = []) => {
    const id = Number(params[0]);
    if (sql === PHASE_SESSION_AI_SERVICES_SQL) {
        return phases.has(id) ? [{ ai_services_enabled: switches.get(phases.get(id)) }] : [];
    }
    if (sql === SESSION_ACTIVITY_DESIGN_SQL) {
        return switches.has(id) ? [{ design: DESIGN_ID, ai_services_enabled: switches.get(id) }] : [];
    }
    if (/SELECT sesid, number\s+FROM stages/u.test(sql)) {
        return phases.has(id) ? [{ sesid: phases.get(id), number: 1 }] : [];
    }
    if (/SELECT design\s+FROM activity/u.test(sql)) {
        return [{ design: DESIGN_ID }];
    }
    if (/SELECT design\s+FROM designs/u.test(sql)) {
        return [{ design: DESIGN }];
    }
    return [];
});

after(() => db.restore());

beforeEach(() => db.reset());

const designReads = () => db.queries.filter(({ sql }) => /FROM designs/u.test(sql));

function fakeRegistry() {
    const calls = [];
    return {
        calls,
        dispatchHook: async (hookName, context, options) => {
            calls.push({ hookName, context, options });
            return [];
        },
    };
}

describe("launchAiServicesEnabled", () => {
    it("turns the services off only for a strict boolean false", () => {
        assert.equal(launchAiServicesEnabled(false), false);
        for (const value of [undefined, null, true, "false", 0, "", "off", {}]) {
            assert.equal(launchAiServicesEnabled(value), true, `${JSON.stringify(value)} keeps them on`);
        }
    });
});

describe("sessionAiServicesEnabled", () => {
    it("is off only for a stored false", () => {
        assert.equal(sessionAiServicesEnabled({ ai_services_enabled: false }), false);
        assert.equal(sessionAiServicesEnabled({ ai_services_enabled: true }), true);
        assert.equal(sessionAiServicesEnabled({}), true);
        assert.equal(sessionAiServicesEnabled(null), true);
    });
});

describe("getPhaseExternalServices", () => {
    it("reads the phase's services from the design when the session keeps them", async () => {
        assert.deepEqual(await getPhaseExternalServices(PHASE_ON), {
            enabledServiceIds: ["reviewer"],
            configurations:    { reviewer: { tone: "kind" } },
        });
    });

    it("answers none, without reading the design, when they were turned off", async () => {
        assert.deepEqual(await getPhaseExternalServices(PHASE_OFF), noPhaseExternalServices());
        assert.deepEqual(designReads(), []);
    });
});

describe("getEnabledExternalServiceIdsBySessionId", () => {
    it("is the design's services when the session keeps them", async () => {
        assert.deepEqual(await getEnabledExternalServiceIdsBySessionId(SESSION_ON), ["reviewer"]);
    });

    it("is none, without reading the design, when they were turned off", async () => {
        assert.deepEqual(await getEnabledExternalServiceIdsBySessionId(SESSION_OFF), []);
        assert.deepEqual(designReads(), []);
    });
});

describe("dispatchPhaseHook through the session's switch", () => {
    for (const hookName of ["activity-started", "phase-started", "student-response-submitted",
        "chat-message-received"]) {
        it(`dispatches nothing for ${hookName} when the services were turned off`, async () => {
            const registry = fakeRegistry();

            const outcomes = await dispatchPhaseHook(hookName, { sessionId: SESSION_OFF, phaseId: PHASE_OFF },
                { registry });

            assert.deepEqual(outcomes, []);
            assert.deepEqual(registry.calls, []);
        });
    }

    it("still sends phase-ended to the registry, with no service, so it closes room jobs", async () => {
        const registry = fakeRegistry();
        const context = { sessionId: SESSION_OFF, phaseId: PHASE_OFF };

        await dispatchPhaseHook("phase-ended", context, { registry });

        assert.deepEqual(registry.calls, [{
            hookName: "phase-ended",
            context,
            options:  { enabledServiceIds: [], serviceConfigurations: {} },
        }]);
    });

    it("dispatches the phase's services when the session keeps them", async () => {
        const registry = fakeRegistry();

        await dispatchPhaseHook("phase-started", { sessionId: SESSION_ON, phaseId: PHASE_ON }, { registry });

        assert.equal(registry.calls.length, 1);
        assert.deepEqual(registry.calls[0].options.enabledServiceIds, ["reviewer"]);
    });
});

describe("servicesNotRunningAtLaunch", () => {
    const launch = { design: DESIGN, policyVersionId: 3 };

    it("lists the services that will not run when the services are on", async () => {
        const calls = [];
        const list = async (request) => {
            calls.push(request);
            return [{ id: "reviewer", ui: { translations: null } }];
        };

        const notice = await servicesNotRunningAtLaunch({ ...launch, aiServicesEnabled: true }, { list });

        assert.deepEqual(notice, [{ id: "reviewer", ui: { translations: null } }]);
        assert.deepEqual(calls, [launch]);
    });

    it("skips the warning when the services were turned off", async () => {
        let called = false;
        const list = async () => {
            called = true;
            return [{ id: "reviewer" }];
        };

        assert.deepEqual(await servicesNotRunningAtLaunch({ ...launch, aiServicesEnabled: false }, { list }), []);
        assert.equal(called, false);
    });

    it("never fails the launch: a failed listing is an empty notice", async () => {
        const errors = [];
        const notice = await servicesNotRunningAtLaunch({ ...launch, aiServicesEnabled: true }, {
            list: async () => {
                throw new Error("registry down");
            },
            logger: { error: (...args) => errors.push(args) },
        });

        assert.deepEqual(notice, []);
        assert.equal(errors.length, 1);
    });
});
