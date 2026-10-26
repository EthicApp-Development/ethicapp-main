import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Validator } from "@cfworker/json-schema";

// The rich text contract (#762, version 2 in #784): the fixtures every renderer
// is tested against.
const TREE_SCHEMA_URL = new URL("../rich-text/rich-text-tree-v2.schema.json", import.meta.url);
const FIXTURES_URL = new URL("../rich-text/fixtures.json", import.meta.url);

const treeSchema = JSON.parse(readFileSync(TREE_SCHEMA_URL, "utf8"));
const treeValidator = new Validator(treeSchema, "2020-12", false);
const fixtures = JSON.parse(readFileSync(FIXTURES_URL, "utf8"));
const CONTENT_TYPES = new Set(["text/plain", "text/markdown"]);
const FIXTURE_KEYS = ["name", "contentType", "input", "tree", "plainText"];
const SUBSET_NODE_TYPES = [
    "paragraph", "bulletList", "orderedList", "listItem", "text", "strong", "emphasis", "break",
    "link", "video",
];
const VIDEO_URL_FORMS = [
    "www.youtube.com/watch", "youtube.com/watch", "m.youtube.com/watch", "music.youtube.com/watch",
    "youtu.be/", "www.youtu.be/", "youtube.com/embed/", "youtube.com/shorts/",
    "youtube.com/live/", "youtube.com/v/", "youtube-nocookie.com/embed/",
];

const isMarkdown = fixture => fixture.contentType === "text/markdown";

// Calls visit(siblings) for every array of inline nodes in the tree.
function eachInlineRun(blocks, visit) {
    for (const block of blocks) {
        if (block.type === "paragraph") {
            visitInline(block.children, visit);
        } else if (block.type === "list") {
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
    assert.equal(fixtures.version, 2);
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

test("every YouTube URL form has a video case", () => {
    const videoInputs = fixtures.cases
        .filter(fixture => isMarkdown(fixture)
            && fixture.tree.some(block => block.type === "video"))
        .map(fixture => fixture.input);
    for (const form of VIDEO_URL_FORMS) {
        assert.ok(videoInputs.some(input => input.includes(`//${form}`)
            || input.includes(`.${form}`)), `no video case for ${form}`);
    }
});

test("the plain text of a video names it with its canonical URL", () => {
    for (const fixture of fixtures.cases.filter(isMarkdown)) {
        for (const block of fixture.tree.filter(candidate => candidate.type === "video")) {
            const url = `https://www.youtube.com/watch?v=${block.videoId}`;
            const line = block.title === url ? `Video: ${url}` : `Video: ${block.title} (${url})`;
            assert.ok(fixture.plainText.split("\n").includes(line), `${fixture.name}: ${line}`);
        }
    }
});

const textNode = value => ({ type: "text", value });
const linkNode = (href, extra = {}) => ({
    type: "link", href, children: [textNode("x")], ...extra,
});
const videoNode = (extra = {}) => ({
    type: "video", provider: "youtube", videoId: "M7lc1UVf-VE", title: "El caso", ...extra,
});

test("the tree schema accepts links and videos where the contract allows them", () => {
    const strong = { type: "strong", children: [textNode("b")] };
    const link = { ...linkNode("https://example.org/a?b=1#c"), children: [textNode("a "), strong] };
    const tree = [
        { type: "paragraph", children: [{ type: "emphasis", children: [link] }] },
        videoNode(),
    ];
    const result = treeValidator.validate(tree);
    assert.equal(result.valid, true, describeErrors(result));
});

test("the tree schema rejects nodes and attributes outside the subset", () => {
    const item = { type: "listItem", children: [] };
    const paragraph = children => [{ type: "paragraph", children }];
    const list = (ordered, start, items = [item]) => [{ type: "list", ordered, start, items }];
    const nestedLink = { type: "strong", children: [linkNode("https://example.org/b")] };
    const invalid = [
        ["numbered list without start", list(true, null)],
        ["bulleted list with start", list(false, 2)],
        ["HTML node", [{ type: "html", value: "<b>" }]],
        ["image node", paragraph([{ type: "image", src: "https://example.org/a.png" }])],
        ["attribute on a text node", paragraph([{ type: "text", value: "x", href: "y" }])],
        ["empty paragraph", paragraph([])],
        ["empty text node", paragraph([textNode("")])],
        ["link without href", paragraph([{ type: "link", children: [textNode("x")] }])],
        ["link without text", paragraph([{ ...linkNode("https://example.org"), children: [] }])],
        ["javascript link", paragraph([linkNode("javascript:alert(1)")])],
        ["data link", paragraph([linkNode("data:text/html,x")])],
        ["mailto link", paragraph([linkNode("mailto:a@example.org")])],
        ["relative link", paragraph([linkNode("/caso")])],
        ["link without a host", paragraph([linkNode("https://")])],
        ["quote in an href", paragraph([linkNode("https://example.org/\"onclick=\"x")])],
        ["space in an href", paragraph([linkNode("https://example.org/a b")])],
        ["link with a title", paragraph([linkNode("https://example.org", { title: "t" })])],
        ["link inside a link", paragraph([linkNode("https://example.org", {
            children: [nestedLink],
        })])],
        ["video inside a paragraph", paragraph([videoNode()])],
        ["video inside a list item", list(false, null, [{ ...item, children: [videoNode()] }])],
        ["video with a short id", [videoNode({ videoId: "M7lc1UVf" })]],
        ["video with a URL as id", [videoNode({ videoId: "https://youtu.be/M7lc1UVf-VE" })]],
        ["video from another provider", [videoNode({ provider: "vimeo" })]],
        ["video with a URL", [videoNode({ url: "https://youtu.be/M7lc1UVf-VE" })]],
        ["video with an untrimmed title", [videoNode({ title: " El caso" })]],
        ["video with a title on two lines", [videoNode({ title: "El\ncaso" })]],
        ["video with an empty title", [videoNode({ title: "" })]],
    ];
    for (const [label, tree] of invalid) {
        assert.equal(treeValidator.validate(tree).valid, false, label);
    }
});
