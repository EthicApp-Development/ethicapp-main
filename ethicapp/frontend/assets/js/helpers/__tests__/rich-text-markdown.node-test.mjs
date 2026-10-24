import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { parseRichText } from "../rich-text.js";
import { richTextSchema as schema } from "../rich-text-editor-schema.js";
import { docFromText, markdownFromDoc, videoMarkdown } from "../rich-text-markdown.js";

const FIXTURES_URL = new URL("../../../../../../canonical-schemas/rich-text/fixtures.json",
    import.meta.url);
const { cases } = JSON.parse(readFileSync(FIXTURES_URL, "utf8"));

const MARKDOWN = "text/markdown";
const {
    paragraph, bullet_list: bulletList, ordered_list: orderedList, list_item: listItem,
    hard_break: hardBreak, video, doc,
} = schema.nodes;
const strong = schema.marks.strong.create();
const em = schema.marks.em.create();
const text = (value, marks = []) => schema.text(value, marks);
const p = (...content) => paragraph.create(null, content);
const li = (...content) => listItem.create(null, content);
const br = (marks = []) => hardBreak.create(null, null, marks);
const textNode = value => ({ type: "text", value });
const paragraphNode = (...children) => ({ type: "paragraph", children });
const videoNode = (videoId, title) => ({ type: "video", provider: "youtube", videoId, title });

function readBack(markdown, label) {
    return [parseRichText(markdown, MARKDOWN), `${label}\n--- markdown ---\n${markdown}`];
}

// Saving then reading back must give the tree the document was loaded from.
function assertRoundTrip(source, contentType, label) {
    const markdown = markdownFromDoc(docFromText(schema, source, contentType));
    const [actual, message] = readBack(markdown, label);
    assert.deepEqual(actual, parseRichText(source, contentType), message);
    return markdown;
}

// The editor has no links: it loads a link as its text, marks kept, and saves
// it as text. A text with links therefore reads back without them. Videos
// (#787) read back as videos.
function inlineWithoutLinks(nodes) {
    const result = [];
    for (const node of nodes) {
        let flattened = [node];
        if (node.type === "link") {
            flattened = inlineWithoutLinks(node.children);
        } else if (node.children) {
            flattened = [{ ...node, children: inlineWithoutLinks(node.children) }];
        }
        for (const child of flattened) {
            const last = result[result.length - 1];
            if (child.type === "text" && last?.type === "text") {
                result[result.length - 1] = textNode(last.value + child.value);
            } else {
                result.push(child);
            }
        }
    }
    return result;
}

function withoutLinks(blocks) {
    return blocks.map(block => {
        if (block.type === "video") {
            return block;
        }
        if (block.type === "paragraph") {
            return paragraphNode(...inlineWithoutLinks(block.children));
        }
        return {
            ...block,
            items: block.items.map(item => ({
                ...item, children: withoutLinks(item.children),
            })),
        };
    });
}

function assertDocReadsBack(document, expectedTree, label) {
    const markdown = markdownFromDoc(document);
    const [actual, message] = readBack(markdown, label);
    assert.deepEqual(actual, expectedTree, message);
    return markdown;
}

describe("rich text editor Markdown (#767)", () => {
    it("round-trips every shared fixture, videos as videos and links as text", () => {
        const withVideos = cases.filter(fixture => fixture.tree.some(block =>
            block.type === "video"));
        assert.ok(withVideos.length > 0, "the fixtures hold videos");
        for (const fixture of cases) {
            const document = docFromText(schema, fixture.input, fixture.contentType);
            assertDocReadsBack(document, withoutLinks(fixture.tree), fixture.name);
        }
    });

    it("loads links as their text, marks kept, and videos as video nodes", () => {
        const source = "Lee **[el *caso*](https://example.org)**\n\n"
            + "[El *caso*](https://youtu.be/M7lc1UVf-VE?t=10)";
        const loaded = docFromText(schema, source, MARKDOWN);
        assert.ok(loaded.eq(doc.create(null, [
            p(text("Lee "), text("el ", [strong]), text("caso", [strong, em])),
            video.create({ videoId: "M7lc1UVf-VE", title: "El caso" }),
        ])), loaded.toString());
        assert.equal(markdownFromDoc(loaded),
            "Lee **el _caso_**\n\n[El caso](https://www.youtube.com/watch?v=M7lc1UVf-VE)");
    });

    it("writes a video as its own paragraph, escaping its title on one line", () => {
        const id = "M7lc1UVf-VE";
        const url = `https://www.youtube.com/watch?v=${id}`;
        const titles = [
            ["Introducción", "Introducción"],
            ["*Ética* [1] <b> & `x` \\ fin", "\\*Ética\\* \\[1\\] \\<b\\> \\& \\`x\\` \\\\ fin"],
            ["  dos\n líneas\t ", "dos líneas"],
            ["1. - # título", "1. - \\# título"],
            ["]( https://e.org )", "\\]( https://e.org )"],
            [url, url],
        ];
        for (const [title, escaped] of titles) {
            const markdown = videoMarkdown(id, title);
            assert.equal(markdown, `[${escaped}](${url})`, title);
            const expectedTitle = title.replace(/\s+/gu, " ").trim();
            assert.deepEqual(parseRichText(markdown, MARKDOWN),
                [videoNode(id, expectedTitle)], markdown);
        }
    });

    it("writes an empty video title as the video's URL", () => {
        const id = "M7lc1UVf-VE";
        const url = `https://www.youtube.com/watch?v=${id}`;
        for (const title of ["", "   ", "\n"]) {
            assert.equal(videoMarkdown(id, title), `[${url}](${url})`);
        }
        const document = doc.create(null, [video.create({ videoId: id, title: "" })]);
        assertDocReadsBack(document, [videoNode(id, url)], "empty title");
    });

    it("keeps videos apart from the blocks around them", () => {
        const id = "M7lc1UVf-VE";
        const document = doc.create(null, [
            bulletList.create(null, [li(p(text("a")))]),
            video.create({ videoId: id, title: "Uno" }),
            video.create({ videoId: "dQw4w9WgXcQ", title: "Dos" }),
            bulletList.create(null, [li(p(text("b")))]),
            p(),
        ]);
        const markdown = assertDocReadsBack(document, [
            parseRichText("- a", MARKDOWN)[0],
            videoNode(id, "Uno"),
            videoNode("dQw4w9WgXcQ", "Dos"),
            parseRichText("- b", MARKDOWN)[0],
        ], "videos between lists");
        assert.equal(markdown, "- a\n\n[Uno](https://www.youtube.com/watch?v=M7lc1UVf-VE)"
            + "\n\n[Dos](https://www.youtube.com/watch?v=dQw4w9WgXcQ)\n\n- b");
    });

    it("saves a document holding only a video, and drops a malformed one's link", () => {
        const id = "M7lc1UVf-VE";
        assert.equal(markdownFromDoc(doc.create(null, [video.create({ videoId: id, title: "V" }),
            p()])), `[V](https://www.youtube.com/watch?v=${id})`);
        assert.equal(markdownFromDoc(doc.create(null, [
            video.create({ videoId: "no", title: "- solo *texto*" }),
        ])), "\\- solo \\*texto\\*");
    });

    it("writes breaks with a backslash and escapes Markdown characters", () => {
        assert.equal(assertRoundTrip("Uno\nDos", "text/plain", "plain lines"), "Uno\\\nDos");
        assert.equal(
            assertRoundTrip("**no** *es* `código` #1 <b> & [x]", "text/plain", "plain chars"),
            "\\*\\*no\\*\\* \\*es\\* \\`código\\` \\#1 \\<b\\> \\& \\[x\\]"
        );
        assert.equal(
            assertRoundTrip("- no es lista\n1. tampoco\n+ ni esto\n= ni esto", "text/plain",
                "line starts"),
            "\\- no es lista\\\n1\\. tampoco\\\n\\+ ni esto\\\n\\= ni esto"
        );
        assert.equal(assertRoundTrip("&copy; &amp;", "text/plain", "entities stay literal"),
            "\\&copy; \\&amp;");
    });

    it("keeps emphasis delimiters next to the text", () => {
        const document = doc.create(null, [p(text("a"), text(" b ", [strong]), text("c"))]);
        const tree = [paragraphNode(textNode("a "), { type: "strong", children: [textNode("b")] },
            textNode(" c"))];
        assert.equal(assertDocReadsBack(document, tree, "spaces inside the mark move out"),
            "a **b** c");
    });

    it("nests and switches emphasis", () => {
        const both = [strong, em];
        assertDocReadsBack(doc.create(null, [p(text("ambos", both))]),
            [paragraphNode({ type:     "emphasis", children: [
                { type: "strong", children: [textNode("ambos")] }] })],
            "both marks on the same text");
        assertDocReadsBack(
            doc.create(null, [p(text("fuerte con ", [strong]), text("énfasis", both),
                text(" dentro", [strong]))]),
            parseRichText("**fuerte con *énfasis* dentro**", MARKDOWN),
            "emphasis inside strong"
        );
        assertDocReadsBack(
            doc.create(null, [p(text("uno", [em]), text(" y "), text("dos", [strong]))]),
            parseRichText("*uno* y **dos**", MARKDOWN),
            "separate marks"
        );
        assertDocReadsBack(
            doc.create(null, [p(text("a", [strong]), br([strong]), text("b", [strong]))]),
            parseRichText("**a\\\nb**", MARKDOWN),
            "strong across a break"
        );
    });

    it("keeps lists of the same kind apart", () => {
        const lists = doc.create(null, [
            bulletList.create(null, [li(p(text("a")))]),
            bulletList.create(null, [li(p(text("b")))]),
            orderedList.create({ order: 1 }, [li(p(text("c")))]),
            orderedList.create({ order: 4 }, [li(p(text("d")))]),
        ]);
        const markdown = markdownFromDoc(lists);
        assert.equal(markdown, "- a\n\n* b\n\n1. c\n\n4) d");
        assert.equal(parseRichText(markdown, MARKDOWN).length, 4);
    });

    it("indents item continuations and nested lists", () => {
        const nested = doc.create(null, [orderedList.create({ order: 9 }, [
            li(p(text("nueve"), br(), text("sigue")),
                bulletList.create(null, [li(p(text("a")))])),
            li(p(text("diez")), p(text("párrafo"))),
        ])]);
        const markdown = markdownFromDoc(nested);
        assert.equal(markdown, "9. nueve\\\n   sigue\n   - a\n10. diez\n\n    párrafo");

        const item = (...children) => ({ type: "listItem", children });
        assert.deepEqual(parseRichText(markdown, MARKDOWN), [{
            type:    "list",
            ordered: true,
            start:   9,
            items:   [
                item(
                    paragraphNode(textNode("nueve"), { type: "break" }, textNode("sigue")),
                    {
                        type:    "list",
                        ordered: false,
                        start:   null,
                        items:   [item(paragraphNode(textNode("a")))],
                    }
                ),
                item(paragraphNode(textNode("diez")), paragraphNode(textNode("párrafo"))),
            ],
        }]);
    });

    it("drops empty paragraphs and breaks at paragraph edges", () => {
        const messy = doc.create(null, [p(), p(br(), text("uno"), br()), p(text("  "))]);
        assert.equal(markdownFromDoc(messy), "uno");
        assert.equal(markdownFromDoc(doc.create(null, [p()])), "");
        assert.equal(markdownFromDoc(doc.create(null, [bulletList.create(null, [li(p())])])), "");
    });

    it("loads empty text, empty items and text/plain literally", () => {
        assert.equal(docFromText(schema, "", MARKDOWN).childCount, 1);
        assert.equal(markdownFromDoc(docFromText(schema, "- uno\n-\n- tres", MARKDOWN)),
            "- uno\n-\n- tres");
        const plain = docFromText(schema, "**Línea** uno\nLínea dos", undefined);
        assert.equal(plain.firstChild.textContent, "**Línea** unoLínea dos");
        assert.equal(plain.firstChild.child(1).type.name, "hard_break");
    });
});

// ─── Random documents ──────────────────────────────────────────────────────

// A small seeded generator, so failures reproduce.
function generator(seed) {
    let state = seed;
    const next = () => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
    };
    return { next, pick: items => items[Math.floor(next() * items.length)] };
}

const PIECES = [
    "a", "b", "é", "ñ", "1", "10", " ", "  ", "?", "¿", "!", ".", ",", ")", "(", "*", "_",
    "`", "[", "]", "<", ">", "&", "#", "-", "+", "=", "|", "~", "\\", "&amp;", "1.", "2)",
    "x*y", "€",
    // Link syntax, enabled in contract version 2 (#784), must stay text.
    "https://e.org", "](", "<https://youtu.be/M7lc1UVf-VE>", "mailto:a@e.org",
];
const MARK_SETS = [[], [], [strong], [em], [strong, em]];

function randomParagraph(random) {
    const content = [];
    const count = 1 + Math.floor(random.next() * 6);
    for (let index = 0; index < count; index += 1) {
        if (random.next() < 0.15) {
            content.push(br());
            continue;
        }
        let value = "";
        const length = 1 + Math.floor(random.next() * 4);
        for (let piece = 0; piece < length; piece += 1) {
            value += random.pick(PIECES);
        }
        content.push(text(value, random.pick(MARK_SETS)));
    }
    return paragraph.create(null, content);
}

function randomList(random, depth) {
    const items = [];
    const count = 1 + Math.floor(random.next() * 3);
    for (let index = 0; index < count; index += 1) {
        const nested = random.next() < 0.3
            ? randomBlocks(random, depth + 1).filter(block => block.type !== paragraph)
            : [];
        items.push(listItem.create(null, [randomParagraph(random), ...nested]));
    }
    return random.next() < 0.5
        ? bulletList.create(null, items)
        : orderedList.create({ order: random.pick([1, 1, 3, 0]) }, items);
}

// Video titles mix Markdown characters, brackets, backslashes, whitespace,
// URLs (the video's own included) and nothing at all (#787).
const VIDEO_IDS = ["M7lc1UVf-VE", "dQw4w9WgXcQ", "a_b-c_d-e_f"];
const TITLE_PIECES = [
    ...PIECES, "", "", "\n", "\t", "  ", "[x](https://e.org)", "\\]", "&#97;",
    "https://www.youtube.com/watch?v=M7lc1UVf-VE", "**", "__",
];

function randomVideo(random) {
    let title = "";
    const length = Math.floor(random.next() * 4);
    for (let piece = 0; piece < length; piece += 1) {
        title += random.pick(TITLE_PIECES);
    }
    return video.create({ videoId: random.pick(VIDEO_IDS), title });
}

// Videos only at the top level, as the schema and the contract allow.
function randomBlocks(random, depth) {
    const blocks = [];
    const count = 1 + Math.floor(random.next() * 3);
    for (let index = 0; index < count; index += 1) {
        const choice = random.next();
        if (depth === 0 && choice < 0.2) {
            blocks.push(randomVideo(random));
        } else {
            blocks.push(depth < 2 && choice < 0.45
                ? randomList(random, depth)
                : randomParagraph(random));
        }
    }
    return blocks;
}

// What a reader can tell apart: characters with their emphasis, line breaks,
// paragraphs and lists. Whitespace at line edges, emphasis on whitespace and
// empty paragraphs carry no meaning in CommonMark, so they are normalized away.
const WHITESPACE_TEST = /\s/u;

function flattenInline(nodes, marks = new Set(), out = []) {
    for (const node of nodes) {
        if (node.type === "text") {
            for (const character of node.value) {
                const markNames = [...marks].sort().join("");
                out.push(WHITESPACE_TEST.test(character) ? " " : `${character}${markNames}`);
            }
        } else if (node.type === "break") {
            out.push("\n");
        } else {
            flattenInline(node.children, new Set([...marks, node.type]), out);
        }
    }
    return out;
}

// One string per paragraph: lines split at breaks, whitespace trimmed at the
// edges of each line, and empty lines at the paragraph's edges dropped.
function normalizeParagraph(tokens) {
    const lines = [[]];
    for (const token of tokens) {
        if (token === "\n") {
            lines.push([]);
        } else {
            lines[lines.length - 1].push(token);
        }
    }
    const trimmed = lines.map(line => {
        let first = 0;
        let last = line.length;
        while (first < last && line[first] === " ") {
            first += 1;
        }
        while (last > first && line[last - 1] === " ") {
            last -= 1;
        }
        return line.slice(first, last).join("|");
    });
    while (trimmed.length > 0 && trimmed[0] === "") {
        trimmed.shift();
    }
    while (trimmed.length > 0 && trimmed[trimmed.length - 1] === "") {
        trimmed.pop();
    }
    return trimmed.join("\n");
}

function flattenBlocks(blocks) {
    return blocks.map(block => {
        if (block.type === "video") {
            return { videoId: block.videoId, title: block.title };
        }
        if (block.type === "paragraph") {
            return normalizeParagraph(flattenInline(block.children));
        }
        const items = block.items.map(item => flattenBlocks(item.children));
        return { ordered: block.ordered, start: block.start, items };
    }).filter(block => block !== "");
}

function inlineTree(node) {
    const content = [];
    node.forEach(child => {
        if (child.type === hardBreak) {
            content.push({ type: "break" });
            return;
        }
        let wrapped = textNode(child.text);
        for (const mark of child.marks) {
            const type = mark.type.name === "strong" ? "strong" : "emphasis";
            wrapped = { type, children: [wrapped] };
        }
        content.push(wrapped);
    });
    return content;
}

// A video's title as the contract reads it back: on one line, or its URL.
function videoTitle(title, videoId) {
    return title.replace(/\s+/gu, " ").trim()
        || `https://www.youtube.com/watch?v=${videoId}`;
}

function treeFromDoc(node) {
    const result = [];
    node.forEach(child => {
        if (child.type === video) {
            const { videoId, title } = child.attrs;
            result.push({ type: "video", videoId, title: videoTitle(title, videoId) });
            return;
        }
        if (child.type === paragraph) {
            result.push(paragraphNode(...inlineTree(child)));
            return;
        }
        const items = [];
        child.forEach(item => items.push({ type: "listItem", children: treeFromDoc(item) }));
        const ordered = child.type === orderedList;
        result.push({ type: "list", ordered, start: ordered ? child.attrs.order : null, items });
    });
    return result;
}

function hasVideo(document) {
    let found = false;
    document.forEach(child => {
        found ||= child.type === video;
    });
    return found;
}

describe("rich text editor Markdown with random documents (#767, #787)", () => {
    it("reads back every random document: text, emphasis, breaks, lists and videos", () => {
        const random = generator(20261023);
        let videos = 0;
        for (let round = 0; round < 600; round += 1) {
            const document = doc.create(null, randomBlocks(random, 0));
            const markdown = markdownFromDoc(document);
            const actual = flattenBlocks(parseRichText(markdown, MARKDOWN));
            // A document with no visible text or video is saved as "".
            const expected = document.textContent.trim() || hasVideo(document)
                ? flattenBlocks(treeFromDoc(document))
                : [];
            videos += expected.filter(block => block.videoId).length;
            const first = expected.findIndex((block, at) =>
                JSON.stringify(block) !== JSON.stringify(actual[at]));
            assert.deepEqual(actual, expected, [
                `round ${round}, block ${first}`,
                `--- markdown ---\n${markdown}`,
                `--- expected ---\n${JSON.stringify(expected[first])}`,
                `--- actual ---\n${JSON.stringify(actual[first])}`,
            ].join("\n"));
        }
        assert.ok(videos > 100, `only ${videos} videos were generated`);
    });
});
