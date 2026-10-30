// Proves that ethicapp's internal-only /api/admin/ routes are not served at
// the edge (#816): for both NGINX configurations, the location NGINX selects
// for each of them, in any letter case, is one of the two blocking locations
// (`^~ /api/admin/` and `~* ^/api/admin/`), which return 404 without
// proxying. Location selection follows NGINX's rules: an exact match wins;
// otherwise the longest prefix, which stops the search when it is `^~`;
// otherwise the first matching regex in file order; otherwise that longest
// prefix. Prefix and exact matches are case-sensitive; `~*` regexes are not.
//
// `npm run test:nginx-edge` checks the same thing against a running NGINX.
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const CONFIGS = ["default.conf.template", "dev.conf"];

const INTERNAL_ROUTES = [
    "/api/admin/ai-services/catalog",
    "/api/admin/ai-services/connection-test",
    "/api/admin/ai-services/",
    "/api/admin/impersonation/professor/12",
    "/api/admin/user-erasure/users/12",
    "/api/admin/user-erasure/users/12/retry",
];

// Spellings that a case-insensitive router would accept.
function caseVariants(uri) {
    return [
        uri.toUpperCase(),
        uri.replace("/api/", "/API/"),
        uri.replace("/admin/", "/Admin/"),
        uri.replace("/ai-services/", "/AI-Services/").replace("/impersonation/", "/Impersonation/")
            .replace("/user-erasure/", "/User-Erasure/"),
    ].filter(variant => variant !== uri);
}

const STOP_PATH = "/api/admin/impersonation/stop";

// Splits a configuration into words, `{`, `}` and `;`, without comments.
function tokenize(text) {
    const tokens = [];
    let index = 0;

    while (index < text.length) {
        const char = text[index];
        if (/\s/u.test(char)) {
            index += 1;
        } else if (char === "#") {
            while (index < text.length && text[index] !== "\n") {
                index += 1;
            }
        } else if (char === "{" || char === "}" || char === ";") {
            tokens.push(char);
            index += 1;
        } else if (char === "\"" || char === "'") {
            let end = index + 1;
            let value = "";
            while (end < text.length && text[end] !== char) {
                if (text[end] === "\\") {
                    end += 1;
                }
                value += text[end];
                end += 1;
            }
            tokens.push(value);
            index = end + 1;
        } else {
            let end = index;
            while (end < text.length && !/[\s{};]/u.test(text[end])) {
                // `${NAME}`: a template variable or a braced NGINX variable.
                if (text[end] === "$" && text[end + 1] === "{") {
                    end = text.indexOf("}", end) + 1;
                    assert.ok(end > 0, "unterminated ${...}");
                    continue;
                }
                end += 1;
            }
            tokens.push(text.slice(index, end));
            index = end;
        }
    }

    return tokens;
}

// Parses tokens into a tree of { name, args, children? } directives.
function parse(tokens) {
    let position = 0;

    function block() {
        const directives = [];
        while (position < tokens.length && tokens[position] !== "}") {
            const words = [];
            while (!["{", ";", "}"].includes(tokens[position])) {
                words.push(tokens[position]);
                position += 1;
            }
            const [name, ...args] = words;
            if (tokens[position] === "{") {
                position += 1;
                directives.push({ name, args, children: block() });
                assert.equal(tokens[position], "}", "unbalanced block");
                position += 1;
            } else {
                assert.equal(tokens[position], ";", `directive ${name} is not terminated`);
                position += 1;
                directives.push({ name, args });
            }
        }
        return directives;
    }

    const directives = block();
    assert.equal(position, tokens.length, "unexpected `}`");
    return directives;
}

function findAll(directives, name) {
    return directives.flatMap(directive => [
        ...(directive.name === name ? [directive] : []),
        ...(directive.children ? findAll(directive.children, name) : []),
    ]);
}

function serverLocations(path) {
    const text = fs.readFileSync(new URL(`../conf.d/${path}`, import.meta.url), "utf8");
    const servers = findAll(parse(tokenize(text)), "server");
    assert.equal(servers.length, 1, `${path} should have one server block`);

    return servers[0].children
        .filter(directive => directive.name === "location")
        .map((directive) => {
            const [first, second] = directive.args;
            const location = second === undefined
                ? { modifier: "", pattern: first }
                : { modifier: first, pattern: second };
            // selectLocation() does not model nested locations.
            assert.equal(
                directive.children.some(child => child.name === "location"),
                false,
                `nested locations in ${path} are not modeled by this test`
            );
            return { ...location, directives: directive.children };
        })
        .filter(location => !location.pattern.startsWith("@"));
}

function matches(location, uri) {
    switch (location.modifier) {
    case "=":
        return uri === location.pattern;
    case "":
    case "^~":
        return uri.startsWith(location.pattern);
    case "~":
        return new RegExp(location.pattern, "u").test(uri);
    case "~*":
        return new RegExp(location.pattern, "iu").test(uri);
    default:
        throw new Error(`unknown location modifier ${location.modifier}`);
    }
}

// The location NGINX picks for a URI.
function selectLocation(locations, uri) {
    const exact = locations.find(location => location.modifier === "=" && matches(location, uri));
    if (exact) {
        return exact;
    }

    const prefix = locations
        .filter(location => (location.modifier === "" || location.modifier === "^~") && matches(location, uri))
        .sort((left, right) => right.pattern.length - left.pattern.length)[0];
    if (prefix?.modifier === "^~") {
        return prefix;
    }

    const regex = locations.find(location => location.modifier.startsWith("~") && matches(location, uri));
    return regex ?? prefix;
}

describe("internal /api/admin/ routes at the NGINX edge", () => {
    for (const config of CONFIGS) {
        describe(config, () => {
            const locations = serverLocations(config);
            const blockingPrefix = locations.find(location => location.modifier === "^~"
                && location.pattern === "/api/admin/");
            const blockingRegex = locations.find(location => location.modifier === "~*"
                && location.pattern === "^/api/admin/");

            for (const [label, blocking] of [
                ["^~ /api/admin/", blockingPrefix],
                ["~* ^/api/admin/", blockingRegex],
            ]) {
                it(`has a blocking \`location ${label}\` that answers 404 without proxying`, () => {
                    assert.ok(blocking, `missing \`location ${label}\``);
                    const names = blocking.directives.map(directive => directive.name);
                    assert.ok(
                        blocking.directives.some(directive => directive.name === "return"
                            && directive.args[0] === "404"),
                        "the location must `return 404`"
                    );
                    for (const forbidden of [
                        "proxy_pass", "fastcgi_pass", "uwsgi_pass", "grpc_pass", "alias", "root",
                    ]) {
                        assert.equal(names.includes(forbidden), false, `must not use ${forbidden}`);
                    }
                });
            }

            for (const uri of INTERNAL_ROUTES) {
                it(`blocks ${uri}`, () => {
                    assert.equal(selectLocation(locations, uri), blockingPrefix);
                });

                it(`blocks other spellings of ${uri}`, () => {
                    for (const variant of caseVariants(uri)) {
                        // `/api/admin/` itself spelled in lower case stays on the prefix.
                        const expected = variant.startsWith("/api/admin/")
                            ? blockingPrefix
                            : blockingRegex;
                        assert.equal(selectLocation(locations, variant), expected, variant);
                    }
                });
            }

            it("tries the case-insensitive block before any other regex that could match", () => {
                const regexes = locations.filter(location => location.modifier.startsWith("~"));
                for (const uri of INTERNAL_ROUTES.flatMap(caseVariants)) {
                    assert.equal(regexes.find(location => matches(location, uri)), blockingRegex, uri);
                }
            });

            it("keeps impersonation stop as the only /api/admin/ exception", () => {
                const exceptions = locations
                    .filter(location => location !== blockingPrefix && location !== blockingRegex
                        && location.pattern.toLowerCase().includes("/api/admin"))
                    .map(location => `${location.modifier} ${location.pattern}`);
                assert.deepEqual(exceptions, [`= ${STOP_PATH}`]);

                const stop = selectLocation(locations, STOP_PATH);
                assert.equal(stop.modifier, "=");
                assert.ok(stop.directives.some(directive => directive.name === "proxy_pass"));
            });
        });
    }

    it("selects locations the way NGINX does", () => {
        const locations = [
            { modifier: "", pattern: "/" },
            { modifier: "", pattern: "/api/" },
            { modifier: "^~", pattern: "/static/" },
            { modifier: "~", pattern: "^/api/.+\\.png$" },
            { modifier: "~*", pattern: "^/api/.+\\.(png|jpg)$" },
            { modifier: "~*", pattern: "^/other/" },
            { modifier: "=", pattern: "/api/exact" },
        ];
        const pick = uri => selectLocation(locations, uri).pattern;

        assert.equal(pick("/api/exact"), "/api/exact");
        assert.equal(pick("/API/exact"), "/");
        assert.equal(pick("/api/x.png"), "^/api/.+\\.png$");
        assert.equal(pick("/api/x.jpg"), "^/api/.+\\.(png|jpg)$");
        assert.equal(pick("/static/x.png"), "/static/");
        assert.equal(pick("/STATIC/x.txt"), "/");
        assert.equal(pick("/api/x"), "/api/");
        assert.equal(pick("/OTHER/x"), "^/other/");
        assert.equal(pick("/elsewhere"), "/");
    });
});
