"use strict";

let assert = require("assert");

describe("String", () => {
    it("String length", () => {
        assert.equal("hola".length, 4);
    });
    it("String substring", () => {
        let initial = "(1,2), (3,4), ";
        let expected = "(1,2), (3,4)";
        assert.equal(initial.substring(0, initial.length - 2), expected);
    });
});