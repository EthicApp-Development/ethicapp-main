import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { hashAnalysisInput, sha256Text, stableStringify } from "../analysis-input-hash.js";

test("stableStringify: sorts object keys at every level and keeps array order", () => {
    assert.equal(
        stableStringify({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } }),
        "{\"a\":{\"c\":null,\"d\":[3,{\"x\":2,\"y\":1}]},\"b\":1}"
    );
    assert.equal(stableStringify([2, 1]), "[2,1]");
});

test("stableStringify: drops undefined properties as JSON does", () => {
    assert.equal(stableStringify({ a: undefined, b: [undefined] }), "{\"b\":[null]}");
    assert.equal(stableStringify(undefined), "null");
    assert.equal(stableStringify("text"), "\"text\"");
});

test("hashAnalysisInput: the same content gives the same hash, whatever the key order", () => {
    const first = hashAnalysisInput({ case: { language: "es", hash: "x" }, questions: ["a"] });
    const second = hashAnalysisInput({ questions: ["a"], case: { hash: "x", language: "es" } });

    assert.equal(first, second);
    assert.match(first, /^sha256:[0-9a-f]{64}$/);
    assert.notEqual(hashAnalysisInput({ questions: ["b"] }), hashAnalysisInput({ questions: ["a"] }));
});

test("sha256Text: the SHA-256 of the UTF-8 text", () => {
    assert.equal(
        sha256Text("¿Qué hacer?"),
        `sha256:${createHash("sha256").update("¿Qué hacer?", "utf8").digest("hex")}`
    );
});
