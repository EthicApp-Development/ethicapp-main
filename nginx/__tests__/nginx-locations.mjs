// Reads EthicApp's NGINX configurations the way NGINX selects a location,
// for the configuration tests in this directory: a tokenizer and parser of
// the configuration files, the server's locations, and the location NGINX
// picks for a URI. Location selection follows NGINX's rules: an exact match
// wins; otherwise the longest prefix, which stops the search when it is `^~`;
// otherwise the first matching regex in file order; otherwise that longest
// prefix. Prefix and exact matches are case-sensitive; `~*` regexes are not.
import assert from "node:assert/strict";
import fs from "node:fs";

export const CONFIGS = ["default.conf.template", "dev.conf"];

// Splits a configuration into words, `{`, `}` and `;`, without comments.
export function tokenize(text) {
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
export function parse(tokens) {
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

export function findAll(directives, name) {
    return directives.flatMap(directive => [
        ...(directive.name === name ? [directive] : []),
        ...(directive.children ? findAll(directive.children, name) : []),
    ]);
}

export function serverLocations(path) {
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

export function matches(location, uri) {
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
export function selectLocation(locations, uri) {
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
