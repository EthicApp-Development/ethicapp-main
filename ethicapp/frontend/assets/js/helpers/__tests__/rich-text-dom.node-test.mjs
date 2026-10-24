import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { parseRichText } from "../rich-text.js";
import { buildRichTextFragment } from "../rich-text-dom.js";

const FIXTURES_URL = new URL("../../../../../../canonical-schemas/rich-text/fixtures.json",
    import.meta.url);
const { cases } = JSON.parse(readFileSync(FIXTURES_URL, "utf8"));

const ALLOWED_TAGS = new Set(["p", "ul", "ol", "li", "strong", "em", "br"]);

// Just enough of a DOM to see what the builder creates.
const fakeDocument = {
    createElement:          tag => ({ tag, attributes: {}, children: [], ...elementMethods }),
    createDocumentFragment: () => fakeDocument.createElement("#fragment"),
    createTextNode:         value => ({ text: value }),
};
const elementMethods = {
    setAttribute(name, value) {
        this.attributes[name] = value;
    },
    appendChild(child) {
        this.children.push(child);
        return child;
    },
};

function escape(text) {
    return text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

function serialize(node) {
    if ("text" in node) {
        return escape(node.text);
    }
    const inner = node.children.map(serialize).join("");
    if (node.tag === "#fragment") {
        return inner;
    }
    const attributes = Object.entries(node.attributes).map(([name, value]) => ` ${name}="${value}"`)
        .join("");
    return node.tag === "br" ? "<br>" : `<${node.tag}${attributes}>${inner}</${node.tag}>`;
}

function render(text, contentType) {
    return buildRichTextFragment(fakeDocument, parseRichText(text, contentType));
}

function eachElement(node, visit) {
    if ("text" in node) {
        return;
    }
    if (node.tag !== "#fragment") {
        visit(node);
    }
    node.children.forEach(child => eachElement(child, visit));
}

describe("rich text DOM in the teacher views (#765)", () => {
    it("builds paragraphs, breaks, emphasis and lists", () => {
        const source = "**Lee** el *caso*\\\ny responde.\n\nDespués:";
        assert.equal(serialize(render(source, "text/markdown")),
            "<p><strong>Lee</strong> el <em>caso</em><br>y responde.</p><p>Después:</p>");
        assert.equal(serialize(render("3. tres\n   - a\n4. cuatro", "text/markdown")),
            "<ol start=\"3\"><li>tres<ul><li>a</li></ul></li><li>cuatro</li></ol>");
        assert.equal(serialize(render("1. uno", "text/markdown")), "<ol><li>uno</li></ol>",
            "start is only set when it is not 1");
    });

    it("keeps the paragraphs of list items with several blocks", () => {
        assert.equal(serialize(render("- uno\n\n  sigue\n- dos", "text/markdown")),
            "<ul><li><p>uno</p><p>sigue</p></li><li>dos</li></ul>");
    });

    it("renders text/plain with its line breaks and nothing interpreted", () => {
        assert.equal(serialize(render("**no**\n- tampoco\n\nfin", "text/plain")),
            "<p>**no**<br>- tampoco</p><p>fin</p>");
        assert.equal(serialize(render("**sin tipo**", undefined)), "<p>**sin tipo**</p>");
    });

    it("puts every fixture's text in text nodes, with only the allowed elements", () => {
        for (const fixture of cases) {
            eachElement(render(fixture.input, fixture.contentType), element => {
                assert.ok(ALLOWED_TAGS.has(element.tag), `${fixture.name}: <${element.tag}>`);
                const attributes = Object.keys(element.attributes);
                assert.ok(attributes.length === 0 || (element.tag === "ol"
                    && attributes.join() === "start" && /^\d+$/u.test(element.attributes.start)),
                `${fixture.name}: attributes ${attributes.join()} on <${element.tag}>`);
            });
        }
        assert.equal(serialize(render("<img src=x onerror=\"alert(1)\">", "text/markdown")),
            "<p>&lt;img src=x onerror=\"alert(1)\"&gt;</p>");
    });

    it("shows links as their text and videos as their title until #785", () => {
        const source = "Lee [el **caso**](https://example.org) y <https://example.org/b>"
            + "\n\n[El <video>](https://youtu.be/M7lc1UVf-VE)";
        assert.equal(serialize(render(source, "text/markdown")),
            "<p>Lee el <strong>caso</strong> y https://example.org/b</p><p>El &lt;video&gt;</p>");
        assert.equal(serialize(render("- [uno](https://example.org)", "text/markdown")),
            "<ul><li>uno</li></ul>");
    });

    it("renders nothing for empty text or a missing tree", () => {
        assert.equal(serialize(render("", "text/markdown")), "");
        assert.equal(serialize(buildRichTextFragment(fakeDocument, undefined)), "");
    });
});
