import assert from "node:assert/strict";
import test from "node:test";

import { launchActivity } from "../activity-launch-helper.js";

const normalize = sql => sql.replace(/\s+/g, " ").trim();

// A fake `pg` client that records statements, optionally failing on one of
// them. `design` is the document the launch reads from `designs`.
function makeClient({ failOn = null, design = null } = {}) {
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
            if (design && /^SELECT design FROM designs WHERE id = \$1;$/u.test(statement)) {
                return { rows: [{ design }] };
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
    assert.match(log[4], /^SELECT design FROM designs WHERE id = \$1;$/);
    assert.match(log[5], /^UPDATE sessions SET time_mode = \$1 WHERE id = \$2 AND NOT EXISTS \(/);
    assert.match(log[6], /^INSERT INTO activity \(design, session\)/);
    assert.match(log[7], /^UPDATE designs SET locked = TRUE WHERE id = \$1;$/);
    assert.equal(log[8], "COMMIT");
    assert.equal(log.length, 9);
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

test("launchActivity: stores the time mode of a design with durations (#1109)", async () => {
    const TIMED = { phases: [{ durationMinutes: 10 }, {}] };
    const storedMode = async (launch, design) => {
        const { client, log, params } = makeClient({ design });
        const { pin } = makePin(log);
        await launchActivity(launch, { connect: async () => client, pinSessionPolicy: pin });
        const index = log.findIndex(statement => statement.startsWith("UPDATE sessions SET time_mode"));
        assert.ok(index > 0);
        // Only while the session has no activity, so a relaunch keeps it.
        assert.match(log[index], /NOT EXISTS \( SELECT 1 FROM activity WHERE activity.session = sessions.id \)/);
        assert.ok(index < log.findIndex(statement => statement.startsWith("INSERT INTO activity")));
        // The design is read inside the transaction, with the launch's design id.
        assert.deepEqual(params[log.indexOf("SELECT design FROM designs WHERE id = $1;") - 1], [34]);
        return params[index - 1];
    };

    assert.deepEqual(await storedMode(LAUNCH, TIMED), ["none", 12]);
    assert.deepEqual(await storedMode({ ...LAUNCH, timeMode: "soft" }, TIMED), ["soft", 12]);
    assert.deepEqual(await storedMode({ ...LAUNCH, timeMode: "hard" }, TIMED), ["hard", 12]);
    assert.deepEqual(await storedMode({ ...LAUNCH, timeMode: "none" }, TIMED), ["none", 12]);

    // A design without any duration has no clock: "none" whatever is asked.
    for (const design of [{ phases: [{}, {}] }, { phases: [] }, {}, null]) {
        assert.deepEqual(await storedMode({ ...LAUNCH, timeMode: "hard" }, design), ["none", 12],
            JSON.stringify(design));
    }
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
