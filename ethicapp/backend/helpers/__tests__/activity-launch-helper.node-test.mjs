import assert from "node:assert/strict";
import test from "node:test";

import { launchActivity } from "../activity-launch-helper.js";

const normalize = sql => sql.replace(/\s+/g, " ").trim();

// A fake `pg` client that records statements, optionally failing on one of them.
function makeClient({ failOn = null } = {}) {
    const log = [];
    const params = [];
    const client = {
        released: false,
        async query(sql, values = []) {
            const statement = normalize(sql);
            log.push(statement);
            params.push(values);
            if (failOn && failOn.test(statement)) {
                throw new Error(`Failed: ${statement}`);
            }
            return { rows: [] };
        },
        release() {
            client.released = true;
        },
    };
    return { client, log, params };
}

function makePin(log, result = 5) {
    const calls = [];
    const pin = async (client, sessionId) => {
        calls.push({ client, sessionId });
        log.push("PIN");
        return result;
    };
    return { pin, calls };
}

const LAUNCH = { sessionId: 12, designId: 34, sessionCode: "ABC123" };

test("launchActivity: pins the session inside the launch transaction", async () => {
    const { client, log } = makeClient();
    const { pin, calls } = makePin(log);

    const result = await launchActivity(LAUNCH, {
        connect:          async () => client,
        pinSessionPolicy: pin,
    });

    assert.deepEqual(result, { policyVersionId: 5 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].client, client);
    assert.equal(calls[0].sessionId, 12);

    assert.equal(log[0], "BEGIN");
    assert.equal(log[1], "PIN");
    assert.match(log[2], /^UPDATE sessions SET code = \$1 WHERE id = \$2 AND code IS NULL;$/);
    assert.match(log[3], /^UPDATE sessions SET ai_services_enabled = \$1 WHERE id = \$2 AND NOT EXISTS \(/);
    assert.match(log[4], /^INSERT INTO activity \(design, session\)/);
    assert.match(log[5], /^UPDATE designs SET locked = TRUE WHERE id = \$1;$/);
    assert.equal(log[6], "COMMIT");
    assert.equal(log.length, 7);
    assert.ok(client.released);
});

test("launchActivity: stores the AI services switch, on unless turned off (#970)", async () => {
    const switchOf = async (launch) => {
        const { client, log, params } = makeClient();
        const { pin } = makePin(log);
        await launchActivity(launch, { connect: async () => client, pinSessionPolicy: pin });
        const index = log.findIndex(statement => statement.startsWith("UPDATE sessions SET ai_services_enabled"));
        assert.ok(index > 0);
        // Only while the session has no activity, so a relaunch keeps it.
        assert.match(log[index], /NOT EXISTS \( SELECT 1 FROM activity WHERE activity.session = sessions.id \)/);
        assert.ok(index < log.findIndex(statement => statement.startsWith("INSERT INTO activity")));
        return params[index - 1];
    };

    assert.deepEqual(await switchOf(LAUNCH), [true, 12]);
    assert.deepEqual(await switchOf({ ...LAUNCH, aiServicesEnabled: true }), [true, 12]);
    assert.deepEqual(await switchOf({ ...LAUNCH, aiServicesEnabled: false }), [false, 12]);
});

test("launchActivity: a failing step rolls back the pin and the launch", async () => {
    const { client, log } = makeClient({ failOn: /^INSERT INTO activity/ });
    const { pin } = makePin(log);

    await assert.rejects(
        launchActivity(LAUNCH, { connect: async () => client, pinSessionPolicy: pin }),
        /Failed: INSERT INTO activity/
    );

    assert.deepEqual(log.slice(0, 2), ["BEGIN", "PIN"]);
    assert.equal(log.at(-1), "ROLLBACK");
    assert.ok(!log.includes("COMMIT"));
    assert.ok(!log.some(statement => statement.startsWith("UPDATE designs")));
    assert.ok(client.released);
});

test("launchActivity: a failing pin rolls back before anything else runs", async () => {
    const { client, log } = makeClient();
    const pin = async () => {
        throw new Error("pin failed");
    };

    await assert.rejects(
        launchActivity(LAUNCH, { connect: async () => client, pinSessionPolicy: pin }),
        /pin failed/
    );

    assert.deepEqual(log, ["BEGIN", "ROLLBACK"]);
    assert.ok(client.released);
});
