"use strict";

let ok = (expr, msg) => {
    if (!expr) throw new Error(msg);
};

suite("String");

test("lenght", function () {
    ok("hola".length == 4);
});