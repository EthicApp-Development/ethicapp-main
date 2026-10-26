import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    moveFocusDirection,
    moveListItem,
    removeListItem,
    sameOrderedKeys,
} from "../ordered-list.js";

describe("moveListItem (#793)", () => {
    it("moves an item up and down", () => {
        assert.deepEqual(moveListItem(["a", "b", "c"], 0, 1), ["b", "a", "c"]);
        assert.deepEqual(moveListItem(["a", "b", "c"], 2, -2), ["c", "a", "b"]);
    });

    it("returns the same list when the move leaves it or the index is wrong", () => {
        const list = ["a", "b"];
        assert.equal(moveListItem(list, 0, -1), list);
        assert.equal(moveListItem(list, 1, 1), list);
        assert.equal(moveListItem(list, 5, -1), list);
        assert.equal(moveListItem(null, 0, 1), null);
    });
});

describe("removeListItem (#793)", () => {
    it("removes the item at an index, and nothing for a wrong index", () => {
        const list = ["a", "b", "c"];
        assert.deepEqual(removeListItem(list, 1), ["a", "c"]);
        assert.equal(removeListItem(list, 3), list);
        assert.equal(removeListItem(list, -1), list);
    });
});

describe("sameOrderedKeys (#793)", () => {
    it("compares keys and their order", () => {
        assert.equal(sameOrderedKeys(["a", "b"], ["a", "b"]), true);
        assert.equal(sameOrderedKeys(["a", "b"], ["b", "a"]), false);
        assert.equal(sameOrderedKeys(["a"], ["a", "b"]), false);
        assert.equal(sameOrderedKeys([], undefined), true);
    });
});

describe("moveFocusDirection (#793)", () => {
    it("keeps the direction while the item can still move that way", () => {
        assert.equal(moveFocusDirection(-1, 1, 3), "up");
        assert.equal(moveFocusDirection(1, 1, 3), "down");
    });

    it("switches to the other button at either end", () => {
        assert.equal(moveFocusDirection(-1, 0, 3), "down");
        assert.equal(moveFocusDirection(1, 2, 3), "up");
    });
});
