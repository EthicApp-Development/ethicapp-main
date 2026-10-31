import assert from "node:assert/strict";
import test from "node:test";
import {
    DESIGN_LOCKED_CODE,
    UPDATE_UNLOCKED_DESIGN_SQL,
    designLockedRefusal,
    designUpdateRefusal,
} from "../design-update.js";

const OWNER = 7;

test("designUpdateRefusal: the owner may update an unlocked design", () => {
    assert.equal(designUpdateRefusal({ id: 1, creator: OWNER, locked: false }, OWNER), null);
    assert.equal(designUpdateRefusal({ id: 1, creator: "7", locked: null }, OWNER), null,
        "ids compare as numbers and a null lock is unlocked");
});

test("designUpdateRefusal: a locked design answers 409 DESIGN_LOCKED (#730)", () => {
    const refusal = designUpdateRefusal({ id: 1, creator: OWNER, locked: true }, OWNER);

    assert.equal(refusal.status, 409);
    assert.equal(refusal.body.code, DESIGN_LOCKED_CODE);
    assert.equal(refusal.body.status, "err");
    assert.deepEqual(refusal, designLockedRefusal());
});

test("designUpdateRefusal: 404 for a missing design, including singleSQL's empty row", () => {
    for (const existing of [undefined, null, {}]) {
        assert.equal(designUpdateRefusal(existing, OWNER).status, 404, JSON.stringify(existing));
    }
});

test("designUpdateRefusal: another teacher's design gets a missing design's 404 (#929)", () => {
    const missing = designUpdateRefusal({}, OWNER);

    assert.deepEqual(designUpdateRefusal({ id: 1, creator: 8, locked: true }, OWNER), missing,
        "ownership is checked before the lock");
    assert.deepEqual(designUpdateRefusal({ id: 1, creator: 8, locked: false }, OWNER), missing);
    const unlocked = { id: 1, creator: OWNER, locked: false };
    assert.deepEqual(designUpdateRefusal(unlocked, undefined), missing);
});

test("the content UPDATE repeats the lock check and reports whether it ran", () => {
    const sql = UPDATE_UNLOCKED_DESIGN_SQL.replace(/\s+/gu, " ");

    assert.match(sql, /WHERE id = \$3 AND locked IS NOT TRUE RETURNING id/u);
    assert.doesNotMatch(sql, /SET[^;]*\blocked\s*=/u, "the update never changes the lock");
});
