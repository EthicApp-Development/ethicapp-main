// POST /designs and PATCH /designs/:id refuse a phase duration that is not a
// whole number of minutes from 1 to 180 with 400 INVALID_PHASE_DURATION,
// before reading or writing anything (#1107, epic #1105). PostgreSQL is a fake
// pg pool that answers by matching the SQL, so nothing here needs a database.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import designsRouter from "../designs.js";
import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";

const OWNER_ID = 7;
const DESIGN_ID = 12;
const CREATED_ID = 500;

let storedDesignJson = null;

function rowsFor(sql, params = []) {
    if (/^\s*SELECT\b[\s\S]*\bFROM designs\b[\s\S]*WHERE id = \$1\b/u.test(sql)
        && Number(params[0]) === DESIGN_ID) {
        return [{
            id:               DESIGN_ID,
            creator:          OWNER_ID,
            locked:           false,
            design:           { metainfo: { title: "Design" }, phases: [] },
            visibility:       "private",
            license_code:     "CC-BY-4.0",
            attribution_text: null,
            language_code:    "en_US",
            case_id:          null,
        }];
    }
    if (/^\s*UPDATE designs\s+SET design = \$1/u.test(sql)) {
        storedDesignJson = params[0];
        return [{ id: DESIGN_ID }];
    }
    if (/^\s*INSERT INTO designs\s*\(/u.test(sql)) {
        storedDesignJson = params[1];
        return [{ id: CREATED_ID }];
    }
    return [];
}

const db = installFakePgPool(rowsFor);

after(() => db.restore());

beforeEach(() => {
    db.reset();
    storedDesignJson = null;
});

function designWithDuration(durationMinutes) {
    const phase = { mode: "individual", prevPhasesResponse: [], questions: [] };
    if (durationMinutes !== undefined) {
        phase.durationMinutes = durationMinutes;
    }
    return {
        type:     "semantic_differential",
        metainfo: { title: "Design" },
        phases:   [{ mode: "individual", prevPhasesResponse: [] }, phase],
    };
}

const routes = {
    "POST /designs": design => ({
        method: "POST",
        path:   "/designs",
        body:   { design, visibility: "private" },
    }),
    "PATCH /designs/:id": design => ({
        method: "PATCH",
        path:   `/designs/${DESIGN_ID}`,
        body:   { design, visibility: "private" },
    }),
};

function send(route, design) {
    return requestRouter(designsRouter, {
        ...routes[route](design),
        session: { uid: OWNER_ID, role: "P" },
    });
}

for (const route of Object.keys(routes)) {
    describe(`${route} checks phase durations (#1107)`, () => {
        for (const minutes of [0, -5, 181, 2.5, "10", null]) {
            it(`refuses ${JSON.stringify(minutes)} before touching the database`, async () => {
                const { status, body } = await send(route, designWithDuration(minutes));

                assert.equal(status, 400);
                assert.equal(body.code, "INVALID_PHASE_DURATION");
                assert.deepEqual(body.errors, [{ phaseIndex: 1 }]);
                assert.deepEqual(db.queries, []);
            });
        }

        for (const minutes of [undefined, 1, 180]) {
            const label = minutes === undefined ? "a phase without a duration" : minutes;
            it(`stores ${label}`, async () => {
                const { status } = await send(route, designWithDuration(minutes));

                assert.equal(status, 200);
                const stored = JSON.parse(storedDesignJson);
                assert.equal(stored.phases[1].durationMinutes, minutes);
                assert.equal(Object.hasOwn(stored.phases[0], "durationMinutes"), false);
            });
        }
    });
}
