import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Validator } from "@cfworker/json-schema";

// The rich text contract (#762): the fixtures every renderer is tested against.
const TREE_SCHEMA_URL = new URL("../rich-text/rich-text-tree-v1.schema.json", import.meta.url);
const FIXTURES_URL = new URL("../rich-text/fixtures.json", import.meta.url);

const treeSchema = JSON.parse(readFileSync(TREE_SCHEMA_URL, "utf8"));
const treeValidator = new Validator(treeSchema, "2020-12", false);
const fixtures = JSON.parse(readFileSync(FIXTURES_URL, "utf8"));
const CONTENT_TYPES = new Set(["text/plain", "text/markdown"]);
const FIXTURE_KEYS = ["name", "contentType", "input", "tree", "plainText"];
const SUBSET_NODE_TYPES = [
    "paragraph", "bulletList", "orderedList", "listItem", "text", "strong", "emphasis", "break",
];

const isMarkdown = fixture => fixture.contentType === "text/markdown";

// Calls visit(siblings) for every array of inline nodes in the tree.
function eachInlineRun(blocks, visit) {
    for (const block of blocks) {
        if (block.type === "paragraph") {
            visitInline(block.children, visit);
        } else {
            for (const item of block.items) {
                eachInlineRun(item.children, visit);
            }
        }
    }
}

function visitInline(nodes, visit) {
    visit(nodes);
    for (const node of nodes) {
        if (node.children) {
            visitInline(node.children, visit);
        }
    }
}

function nodeTypes(blocks, types = new Set()) {
    for (const block of blocks) {
        types.add(block.type);
        if (block.type === "list") {
            types.add(block.ordered ? "orderedList" : "bulletList");
            for (const item of block.items) {
                types.add(item.type);
                nodeTypes(item.children, types);
            }
        } else {
            eachInlineRun([block], nodes => nodes.forEach(node => types.add(node.type)));
        }
    }
    return types;
}

function describeErrors(result) {
    return result.errors.map(error => `${error.instanceLocation}: ${error.error}`).join("\n");
}

test("the fixtures file is versioned and its cases are well formed", () => {
    assert.equal(fixtures.version, 1);
    assert.ok(Array.isArray(fixtures.cases) && fixtures.cases.length > 0);

    const names = new Set();
    for (const fixture of fixtures.cases) {
        assert.equal(typeof fixture.name, "string");
        assert.ok(!names.has(fixture.name), `duplicate case name: ${fixture.name}`);
        names.add(fixture.name);
        assert.equal(typeof fixture.input, "string", fixture.name);
        assert.equal(typeof fixture.plainText, "string", fixture.name);
        if ("contentType" in fixture) {
            assert.equal(typeof fixture.contentType, "string", fixture.name);
        }
        const unknownKeys = Object.keys(fixture).filter(key => !FIXTURE_KEYS.includes(key));
        assert.deepEqual(unknownKeys, [], fixture.name);
    }
});

test("every expected tree matches the tree schema", () => {
    for (const fixture of fixtures.cases) {
        const result = treeValidator.validate(fixture.tree);
        assert.equal(result.valid, true, `${fixture.name}:\n${describeErrors(result)}`);
    }
});

test("expected trees are normalized: no adjacent or empty text nodes", () => {
    for (const fixture of fixtures.cases) {
        eachInlineRun(fixture.tree, nodes => {
            nodes.forEach((node, index) => {
                if (node.type !== "text") {
                    return;
                }
                assert.notEqual(node.value, "", `${fixture.name}: empty text node`);
                assert.notEqual(nodes[index + 1]?.type, "text",
                    `${fixture.name}: adjacent text nodes`);
            });
        });
    }
});

test("text/plain is never interpreted, and its plain text is the input", () => {
    const plainCases = fixtures.cases.filter(fixture => !isMarkdown(fixture));
    assert.ok(plainCases.some(fixture => !("contentType" in fixture)),
        "a case without a content type");
    assert.ok(plainCases.some(fixture => "contentType" in fixture
        && !CONTENT_TYPES.has(fixture.contentType)), "a case with an unknown content type");

    for (const fixture of plainCases) {
        const interpreted = [...nodeTypes(fixture.tree)]
            .filter(type => !["paragraph", "text", "break"].includes(type));
        assert.deepEqual(interpreted, [], `${fixture.name}: only paragraphs, text and breaks`);
        assert.equal(fixture.plainText, fixture.input, fixture.name);
    }
});

test("the Markdown cases cover every construct of the subset", () => {
    const markdownTrees = fixtures.cases.filter(isMarkdown).flatMap(fixture => fixture.tree);
    const covered = nodeTypes(markdownTrees);
    for (const type of SUBSET_NODE_TYPES) {
        assert.ok(covered.has(type), `no Markdown case covers ${type}`);
    }
});

test("no plain-text line ends with whitespace", () => {
    for (const fixture of fixtures.cases.filter(isMarkdown)) {
        assert.doesNotMatch(fixture.plainText, /[ \t]$/mu, fixture.name);
    }
});

test("the tree schema rejects nodes and attributes outside the subset", () => {
    const item = { type: "listItem", children: [] };
    const paragraph = children => [{ type: "paragraph", children }];
    const link = { type: "link", children: [{ type: "text", value: "x" }] };
    const list = (ordered, start) => [{ type: "list", ordered, start, items: [item] }];
    const invalid = {
        "numbered list without start": list(true, null),
        "bulleted list with start":    list(false, 2),
        "HTML node":                   [{ type: "html", value: "<b>" }],
        "link node":                   paragraph([link]),
        "attribute on a text node":    paragraph([{ type: "text", value: "x", href: "y" }]),
        "empty paragraph":             paragraph([]),
        "empty text node":             paragraph([{ type: "text", value: "" }]),
    };
    for (const [label, tree] of Object.entries(invalid)) {
        assert.equal(treeValidator.validate(tree).valid, false, label);
    }
});
