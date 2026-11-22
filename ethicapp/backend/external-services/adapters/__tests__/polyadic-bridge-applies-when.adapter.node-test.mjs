// The phase settings the Polyadic bridge sends (#1234, epic
// ethicapp-ai-additions#312): a field whose `applies_when` does not hold on
// the configuration the room is created with is not sent, while the design
// keeps its value. Polyadic's `topic_tracking` applies to `contentCoverage`
// rooms only (ethicapp-ai-additions#314). A descriptor without
// `applies_when` sends every setting, as before. The AI Additions client,
// the descriptor and the room jobs are fakes.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applicableRoomSettings, register } from "../polyadic-bridge.adapter.js";
import { normalizeDescriptor } from "../../../services/capability-descriptors.service.js";

const SESSION_ID = 11;
const PHASE_ID = 22;

function rawField(key, type, extra = {}) {
    return {
        key,
        type,
        required:   false,
        default:    null,
        display:    { label: key },
        validation: {},
        ...extra,
    };
}

// Polyadic's descriptor as the registry hands it over, normalized.
function descriptorOf({ withAppliesWhen = true } = {}) {
    const topicTracking = rawField("topic_tracking", "boolean", {
        default: true,
        display: { label: "Topic tracking", group: "advanced" },
        ...(withAppliesWhen
            ? { applies_when: [{ field: "pipeline_type", in: ["contentCoverage"] }] }
            : {}),
    });
    const { descriptor } = normalizeDescriptor({
        contract_version:       "1",
        service:                { id: "polyadic-agent", name: "Polyadic Agents", uses_llm: true },
        instance_configuration: { fields: [
            rawField("pipeline_type", "enum", {
                default:    "standard",
                validation: { enum: [
                    { value: "standard", label: "Standard" },
                    { value: "devilsAdvocate", label: "Devil's advocate" },
                    { value: "contentCoverage", label: "Content coverage" },
                ] },
            }),
            rawField("llm_tier", "enum", {
                default:    "basic",
                validation: { enum: [
                    { value: "basic", label: "Basic" }, { value: "advanced", label: "Advanced" },
                ] },
            }),
            topicTracking,
        ] },
        runtime_configuration: { fields: [] },
    }, "polyadic-agent");
    return { available: true, ...descriptor };
}

function quietly(action) {
    const original = { info: console.info, warn: console.warn };
    console.info = () => {};
    console.warn = () => {};
    return Promise.resolve().then(action).finally(() => Object.assign(console, original));
}

function createHarness({ descriptor = descriptorOf(), teamIds = [301] } = {}) {
    const subscribers = new Map();
    const requests = [];
    let nextRoomJob = 0;

    return {
        sessionBodies() {
            return requests.filter(request => request.pathname.endsWith("/sessions"))
                .map(request => request.body);
        },
        async initialize() {
            await register({
                service: { id: "polyadic-devils-advocate" },
                subscribe(hookName, handler) {
                    subscribers.set(hookName, handler);
                },
                async publishGroupChatMessage() {
                    return null;
                },
                aiAdditionsClient: {
                    async getEndpoints() {
                        return { baseUrl: "http://ai.local" };
                    },
                    async requestJson(pathname, options) {
                        requests.push({ pathname, body: options.body });
                        return {
                            status:                       "created",
                            warnings:                     [],
                            degraded:                     false,
                            ethicapp_room_correlation_id: options.body?.ethicapp_room_correlation_id,
                        };
                    },
                },
                sessionInputs: {
                    declares:   async () => false,
                    descriptor: async () => descriptor,
                },
                roomJobs: {
                    create: async () => ({ id: `room-job-${++nextRoomJob}` }),
                    open:   async () => true,
                    fail:   async () => {},
                },
                polyadicBridgeDependencies: {
                    getTeamIdsForPhase:         async () => teamIds,
                    getFirstQuestionIdForPhase: async () => 701,
                    getFirstQuestionForPhase:   async () => ({ id: 701, title: "Question" }),
                    getCaseIdBySessionId:       async () => null,
                    getCaseDocumentRawText:     async () => "Case text.",
                    getParticipantIdentity:     async () => null,
                    getSessionLanguageCode:     async () => "es_CL",
                    getPhaseClock:              async () => null,
                    caseInputDependencies:      {
                        producerServiceIds: async () => [],
                        getCaseAnalysis:    async () => null,
                    },
                },
            });
        },
        async dispatch(hookName, context) {
            await subscribers.get(hookName)(context, {
                callback:            async result => result,
                reportInstantiation: async report => report,
            });
        },
        phaseStarted(serviceConfiguration) {
            return this.dispatch("phase-started",
                { sessionId: SESSION_ID, phaseId: PHASE_ID, serviceConfiguration });
        },
        chatMessage(serviceConfiguration) {
            return this.dispatch("chat-message-received", {
                sessionId:     SESSION_ID,
                phaseId:       PHASE_ID,
                groupId:       301,
                userId:        9001,
                correlationId: "corr-1",
                content:       "Hola",
                serviceConfiguration,
            });
        },
    };
}

async function bodiesFor(serviceConfiguration, options = {}) {
    const harness = createHarness(options);
    await harness.initialize();
    await harness.phaseStarted(serviceConfiguration);
    return harness.sessionBodies();
}

describe("settings whose applies_when does not hold are not sent", () => {
    it("sends topic_tracking to a contentCoverage room", () => quietly(async () => {
        const [body] = await bodiesFor({ pipeline_type: "contentCoverage", topic_tracking: false });

        assert.equal(body.pipeline_type, "contentCoverage");
        assert.equal(body.topic_tracking, false);
    }));

    it("leaves it out of other modes' rooms, whose payloads stay as they were", () => quietly(async () => {
        for (const pipelineType of ["devilsAdvocate", "standard"]) {
            const expected = await bodiesFor({ pipeline_type: pipelineType, llm_tier: "advanced" });
            const bodies = await bodiesFor({
                pipeline_type: pipelineType, llm_tier: "advanced", topic_tracking: false,
            });

            assert.equal(JSON.stringify(bodies), JSON.stringify(expected), pipelineType);
            assert.equal(Object.hasOwn(bodies[0], "topic_tracking"), false, pipelineType);
        }
    }));

    it("a room created from a chat message follows the same rule", () => quietly(async () => {
        const harness = createHarness({ teamIds: [] });
        await harness.initialize();

        await harness.chatMessage({ pipeline_type: "devilsAdvocate", topic_tracking: false });

        const [body] = harness.sessionBodies();
        assert.equal(body.pipeline_type, "devilsAdvocate");
        assert.equal(Object.hasOwn(body, "topic_tracking"), false);
    }));

    it("evaluates the condition on the pipeline the room is created with", () => quietly(async () => {
        const previous = process.env.AI_ADDITIONS_POLYADIC_AGENTS_PIPELINE_TYPE;
        process.env.AI_ADDITIONS_POLYADIC_AGENTS_PIPELINE_TYPE = "contentCoverage";
        try {
            const [body] = await bodiesFor({ topic_tracking: false });

            assert.equal(body.pipeline_type, "contentCoverage");
            assert.equal(body.topic_tracking, false);
        } finally {
            if (previous === undefined) {
                delete process.env.AI_ADDITIONS_POLYADIC_AGENTS_PIPELINE_TYPE;
            } else {
                process.env.AI_ADDITIONS_POLYADIC_AGENTS_PIPELINE_TYPE = previous;
            }
        }
    }));
});

describe("payloads without applies_when are unchanged", () => {
    const configuration = { pipeline_type: "devilsAdvocate", topic_tracking: false };

    it("a descriptor without applies_when sends every setting", () => quietly(async () => {
        const [body] = await bodiesFor(configuration,
            { descriptor: descriptorOf({ withAppliesWhen: false }) });

        assert.equal(body.topic_tracking, false);
    }));

    it("an unavailable descriptor sends every setting, as before", () => quietly(async () => {
        for (const descriptor of [null, { available: false, reason: "unavailable" }]) {
            const [body] = await bodiesFor(configuration, { descriptor });
            assert.equal(body.topic_tracking, false);
        }
    }));

    it("applicableRoomSettings copies the settings when nothing is conditional", () => {
        const settings = { pipeline_type: "devilsAdvocate", llm_tier: "advanced", topic_tracking: false };
        assert.deepEqual(applicableRoomSettings({
            descriptor:           descriptorOf({ withAppliesWhen: false }),
            locale:               "es-CL",
            serviceConfiguration: settings,
        }), settings);
        assert.equal(applicableRoomSettings({ descriptor: null, serviceConfiguration: settings }),
            settings);
    });
});
