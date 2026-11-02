// GET /designs gives each design its creation time and whether it uses AI
// services, for the launch wizard's list (#967, epic #965). PostgreSQL is a
// fake pg pool, so nothing here needs a database.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import designsRouter from "../designs.js";
import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";

const TEACHER_ID = 7;

function listRow(id, { createdAt, phases, design = {} }) {
    return {
        id,
        design:           { metainfo: { title: `Design ${id}` }, phases, ...design },
        public:           false,
        visibility:       "private",
        locked:           false,
        archived:         false,
        license_code:     "CC-BY-4.0",
        language_code:    "en_US",
        attribution_text: null,
        is_editable_copy: true,
        case_id:          null,
        created_at:       createdAt,
        tags:             [],
        user_owned:       true,
    };
}

const AI_PHASES = [
    { externalServices: { enabledServiceIds: [] } },
    { externalServices: { enabledServiceIds: ["mock-chat-agent"] } },
];
const PLAIN_PHASES = [{ externalServices: { enabledServiceIds: [] } }, {}];

let listRows = [];

const db = installFakePgPool((sql) => (/\bFROM designs d\b/u.test(sql) ? listRows : []));

after(() => db.restore());

beforeEach(() => {
    db.reset();
    listRows = [];
});

async function listDesigns() {
    const { status, body } = await requestRouter(designsRouter, {
        path:    "/designs",
        session: { uid: TEACHER_ID, role: "P" },
    });
    assert.equal(status, 200);
    assert.equal(body.status, "ok");
    return body.result;
}

describe("GET /designs creation time and AI flag (#967)", () => {
    it("reads designs.created_at", async () => {
        await listDesigns();

        const [query] = db.queries;
        assert.match(query.sql, /\bd\.created_at\b/u);
    });

    it("returns createdAt as an ISO string, and null for older designs", async () => {
        listRows = [
            listRow(2, { createdAt: new Date("2026-11-01T12:00:00.000Z"), phases: PLAIN_PHASES }),
            listRow(1, { createdAt: null, phases: PLAIN_PHASES }),
        ];

        const [dated, undated] = await listDesigns();

        assert.equal(dated.createdAt, "2026-11-01T12:00:00.000Z");
        assert.equal(undated.createdAt, null);
    });

    it("sets usesAiServices exactly when some phase enables a service", async () => {
        listRows = [
            listRow(3, { createdAt: null, phases: AI_PHASES }),
            listRow(2, { createdAt: null, phases: PLAIN_PHASES }),
            listRow(1, { createdAt: null, phases: undefined }),
        ];

        const designs = await listDesigns();

        assert.deepEqual(designs.map(design => [design.id, design.usesAiServices]), [
            [3, true],
            [2, false],
            [1, false],
        ]);
    });

    it("does not let the design document override the computed fields", async () => {
        listRows = [listRow(1, {
            createdAt: null,
            phases:    PLAIN_PHASES,
            design:    { createdAt: "2020-01-01T00:00:00.000Z", usesAiServices: true },
        })];

        const [design] = await listDesigns();

        assert.equal(design.createdAt, null);
        assert.equal(design.usesAiServices, false);
    });
});
