// Teacher-written rich text (#764): turns a text and its content type into the
// normalized tree, and into the plain-text rendition, that
// canonical-schemas/rich-text/README.md defines. Every renderer must pass
// canonical-schemas/rich-text/fixtures.json.
//
// This module imports nothing: callers pass the markdown-it class, so the
// backend, the teacher frontend and ethicapp-student each resolve their own.
// ethicapp-student builds separately and keeps a byte-identical copy of this
// file (src/utils/richTextCore.js), which its tests compare with this one.

const TEXT_MARKDOWN = "text/markdown";

// CommonMark with only the subset's rules: every other construct is parsed as
// literal paragraph text. Raw HTML and links are never interpreted.
const MARKDOWN_OPTIONS = { html: false, breaks: false, linkify: false };
const SUBSET_RULES = ["list", "emphasis", "newline", "escape", "entity"];

const INLINE_CONTAINERS = {
    strong_open: "strong",
    em_open:     "emphasis",
};
const INLINE_CLOSERS = new Set(["strong_close", "em_close"]);

function isMarkdown(contentType) {
    return contentType === TEXT_MARKDOWN;
}

// Appends an inline node, merging adjacent text and dropping empty text.
function pushInline(nodes, node) {
    if (node.type === "text") {
        if (!node.value) {
            return;
        }
        const last = nodes[nodes.length - 1];
        if (last?.type === "text") {
            last.value += node.value;
            return;
        }
    }
    nodes.push(node);
}

function inlineTree(tokens) {
    const root = [];
    const stack = [root];
    for (const token of tokens) {
        const siblings = stack[stack.length - 1];
        if (token.type === "text") {
            pushInline(siblings, { type: "text", value: token.content });
        } else if (token.type === "softbreak") {
            pushInline(siblings, { type: "text", value: " " });
        } else if (token.type === "hardbreak") {
            siblings.push({ type: "break" });
        } else if (INLINE_CONTAINERS[token.type]) {
            const node = { type: INLINE_CONTAINERS[token.type], children: [] };
            siblings.push(node);
            stack.push(node.children);
        } else if (INLINE_CLOSERS.has(token.type)) {
            stack.pop();
        } else {
            throw new Error(`Unexpected inline token: ${token.type}`);
        }
    }
    return root;
}

function listNode(token) {
    const ordered = token.type === "ordered_list_open";
    return {
        type:  "list",
        ordered,
        start: ordered ? Number(token.attrGet("start") ?? 1) : null,
        items: [],
    };
}

// A paragraph whose text was all empty is dropped, at any depth.
function pruneEmptyParagraphs(blocks) {
    return blocks
        .filter(block => block.type !== "paragraph" || block.children.length > 0)
        .map(block => (block.type !== "list" ? block : {
            ...block,
            items: block.items.map(item => ({
                ...item, children: pruneEmptyParagraphs(item.children),
            })),
        }));
}

function markdownTree(markdown, text) {
    const root = [];
    const stack = [root];
    for (const token of markdown.parse(text, {})) {
        const container = stack[stack.length - 1];
        switch (token.type) {
        case "paragraph_open": {
            const paragraph = { type: "paragraph", children: [] };
            container.push(paragraph);
            stack.push(paragraph.children);
            break;
        }
        case "inline":
            for (const node of inlineTree(token.children)) {
                pushInline(container, node);
            }
            break;
        case "bullet_list_open":
        case "ordered_list_open": {
            const list = listNode(token);
            container.push(list);
            stack.push(list.items);
            break;
        }
        case "list_item_open": {
            const item = { type: "listItem", children: [] };
            container.push(item);
            stack.push(item.children);
            break;
        }
        case "paragraph_close":
        case "bullet_list_close":
        case "ordered_list_close":
        case "list_item_close":
            stack.pop();
            break;
        default:
            throw new Error(`Unexpected block token: ${token.type}`);
        }
    }
    return pruneEmptyParagraphs(root);
}

// text/plain: trimmed, paragraphs at blank lines, lines joined by breaks.
function plainTree(text) {
    const normalized = text.replace(/\r\n?/gu, "\n").trim();
    if (!normalized) {
        return [];
    }
    return normalized.split(/\n[ \t]*\n(?:[ \t]*\n)*/u).map(paragraph => {
        const children = [];
        paragraph.split("\n").forEach((line, index) => {
            if (index > 0) {
                children.push({ type: "break" });
            }
            pushInline(children, { type: "text", value: line });
        });
        return { type: "paragraph", children };
    });
}

function inlineText(nodes) {
    return nodes.map(node => {
        if (node.type === "text") {
            return node.value;
        }
        return node.type === "break" ? "\n" : inlineText(node.children);
    }).join("");
}

// Continuation lines of a list item are indented by its marker's width.
function listItemText(marker, item) {
    const indent = " ".repeat(marker.length);
    const body = item.children.map(child => blocksText([child])).join("\n");
    return marker + body.split("\n")
        .map((line, index) => (index === 0 || line === "" ? line : indent + line))
        .join("\n");
}

function blocksText(blocks) {
    return blocks.map(block => {
        if (block.type === "paragraph") {
            return inlineText(block.children);
        }
        return block.items.map((item, index) => listItemText(
            block.ordered ? `${block.start + index}. ` : "- ",
            item
        )).join("\n");
    }).join("\n\n");
}

/**
 * @param {Function} MarkdownIt - The markdown-it class (version 15.0.3 or later).
 * @returns {{
 *   parseRichText: (text: string, contentType?: string) => object[],
 *   toPlainText: (text: string, contentType?: string) => string,
 * }}
 */
export function createRichText(MarkdownIt) {
    const markdown = new MarkdownIt("zero", MARKDOWN_OPTIONS).enable(SUBSET_RULES);

    /**
     * The normalized tree of `text`. Missing or unknown content types mean
     * text/plain. Should the parser ever produce a token outside the subset,
     * the text is shown as text/plain rather than failing the view.
     */
    function parseRichText(text, contentType) {
        const source = typeof text === "string" ? text : "";
        if (!isMarkdown(contentType)) {
            return plainTree(source);
        }
        try {
            return markdownTree(markdown, source);
        } catch {
            return plainTree(source);
        }
    }

    /**
     * What to send where formatting cannot be shown: text/plain unchanged,
     * text/markdown rendered from its tree, with no trailing whitespace.
     */
    function toPlainText(text, contentType) {
        const source = typeof text === "string" ? text : "";
        if (!isMarkdown(contentType)) {
            return source;
        }
        return blocksText(parseRichText(source, contentType)).replace(/[ \t]+$/gmu, "");
    }

    return { parseRichText, toPlainText };
}
