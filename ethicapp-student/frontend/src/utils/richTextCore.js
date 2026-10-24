// Teacher-written rich text (#764, contract version 2 in #784): turns a text
// and its content type into the normalized tree, and into the plain-text
// rendition, that canonical-schemas/rich-text/README.md defines. Every
// renderer must pass canonical-schemas/rich-text/fixtures.json.
//
// This module imports nothing: callers pass the markdown-it class and the
// YouTube URL functions of ethicapp/common/modules/youtube-urls.js, so the
// backend, the teacher frontend and ethicapp-student each resolve their own.
// ethicapp-student builds separately and keeps a byte-identical copy of this
// file (src/utils/richTextCore.js), which its tests compare with this one.

const TEXT_MARKDOWN = "text/markdown";

// CommonMark with only the subset's rules: every other construct is parsed as
// literal paragraph text. Raw HTML is never interpreted.
const MARKDOWN_OPTIONS = { html: false, breaks: false, linkify: false };
const SUBSET_RULES = ["list", "emphasis", "newline", "escape", "entity", "link", "autolink"];

// The only link destinations: http and https URLs with a host, as markdown-it
// normalizes them. Links to anything else stay literal text.
const HTTP_URL = /^https?:\/\/[^/?#]/iu;
// "](" and ")" with only whitespace between them: an empty link destination.
const EMPTY_DESTINATION = /\]\([ \t\n]*\)/uy;
const OPEN_BRACKET = 0x5B;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/u;

const INLINE_CONTAINERS = {
    strong_open: "strong",
    em_open:     "emphasis",
};
const INLINE_CLOSERS = new Set(["strong_close", "em_close", "link_close"]);

function isMarkdown(contentType) {
    return contentType === TEXT_MARKDOWN;
}

// markdown-it validates every link destination except an empty one, so
// "[text]()" would still be a link. Run just before its "link" rule, this
// passes over the "[" as text, as the link rule does when it fails.
function emptyDestinationLink(state, silent) {
    if (state.src.charCodeAt(state.pos) !== OPEN_BRACKET) {
        return false;
    }
    const labelEnd = state.md.helpers.parseLinkLabel(state, state.pos, true);
    if (labelEnd < 0) {
        return false;
    }
    EMPTY_DESTINATION.lastIndex = labelEnd;
    const match = EMPTY_DESTINATION.exec(state.src);
    if (!match || labelEnd + match[0].length > state.posMax) {
        return false;
    }
    if (!silent) {
        state.pending += "[";
    }
    state.pos += 1;
    return true;
}

function createMarkdown(MarkdownIt) {
    const markdown = new MarkdownIt("zero", MARKDOWN_OPTIONS).enable(SUBSET_RULES);
    markdown.validateLink = url => HTTP_URL.test(url);
    markdown.inline.ruler.before("link", "empty_link_destination", emptyDestinationLink);
    return markdown;
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

function linkNode(token) {
    const href = token.attrGet("href");
    // Never expected, since markdown-it validates destinations with HTTP_URL.
    if (!HTTP_URL.test(href ?? "")) {
        throw new Error("Unexpected link destination");
    }
    return { type: "link", href, children: [] };
}

// A link with no visible text shows its destination instead.
function finishLink(link) {
    if (!inlineText(link.children).trim()) {
        link.children = [{ type: "text", value: link.href }];
    }
}

function inlineTree(tokens) {
    const root = [];
    // Where children go, and whether they are inside a link. A link inside a
    // link's text (markdown-it allows an autolink there) keeps only its text.
    const stack = [{ node: null, children: root, inLink: false }];
    for (const token of tokens) {
        const { children: siblings, inLink } = stack[stack.length - 1];
        if (token.type === "text") {
            pushInline(siblings, { type: "text", value: token.content });
        } else if (token.type === "softbreak") {
            pushInline(siblings, { type: "text", value: " " });
        } else if (token.type === "hardbreak") {
            siblings.push({ type: "break" });
        } else if (INLINE_CONTAINERS[token.type]) {
            const node = { type: INLINE_CONTAINERS[token.type], children: [] };
            siblings.push(node);
            stack.push({ node, children: node.children, inLink });
        } else if (token.type === "link_open" && inLink) {
            stack.push({ node: null, children: siblings, inLink });
        } else if (token.type === "link_open") {
            const node = linkNode(token);
            siblings.push(node);
            stack.push({ node, children: node.children, inLink: true });
        } else if (INLINE_CLOSERS.has(token.type)) {
            const { node } = stack.pop();
            if (node?.type === "link") {
                finishLink(node);
            }
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

// A video's title: the link's text on one line.
function linkTitle(link) {
    return inlineText(link.children).replace(/\s+/gu, " ").trim();
}

// A top-level paragraph whose only content, whitespace aside, is a link to a
// YouTube video is that video. Anywhere else, the link stays a link.
function videoBlock(paragraph, youtubeVideoId) {
    const content = paragraph.children
        .filter(node => node.type !== "text" || node.value.trim());
    if (content.length !== 1 || content[0].type !== "link") {
        return null;
    }
    const videoId = youtubeVideoId(content[0].href);
    if (typeof videoId !== "string" || !VIDEO_ID.test(videoId)) {
        return null;
    }
    return { type: "video", provider: "youtube", videoId, title: linkTitle(content[0]) };
}

function markdownTree(markdown, text, youtubeVideoId) {
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
    return pruneEmptyParagraphs(root).map(block => (block.type === "paragraph"
        && youtubeVideoId && videoBlock(block, youtubeVideoId)) || block);
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

// "text (URL)", or just the URL when the text is the URL.
function withUrl(text, url) {
    return text === url ? url : `${text} (${url})`;
}

function inlineText(nodes) {
    return nodes.map(node => {
        if (node.type === "text") {
            return node.value;
        }
        if (node.type === "break") {
            return "\n";
        }
        const text = inlineText(node.children);
        return node.type === "link" ? withUrl(text, node.href) : text;
    }).join("");
}

// Continuation lines of a list item are indented by its marker's width.
function listItemText(marker, item, videoUrl) {
    const indent = " ".repeat(marker.length);
    const body = item.children.map(child => blocksText([child], videoUrl)).join("\n");
    return marker + body.split("\n")
        .map((line, index) => (index === 0 || line === "" ? line : indent + line))
        .join("\n");
}

function blocksText(blocks, videoUrl) {
    return blocks.map(block => {
        if (block.type === "paragraph") {
            return inlineText(block.children);
        }
        if (block.type === "video") {
            return `Video: ${withUrl(block.title, videoUrl(block.videoId))}`;
        }
        return block.items.map((item, index) => listItemText(
            block.ordered ? `${block.start + index}. ` : "- ",
            item,
            videoUrl
        )).join("\n");
    }).join("\n\n");
}

/**
 * @param {Function} MarkdownIt - The markdown-it class (version 15.0.3 or later).
 * @param {object} [youtube] - From ethicapp/common/modules/youtube-urls.js.
 *   Without both functions, no video blocks are made.
 * @param {(url: string) => string|null} [youtube.youtubeVideoId]
 * @param {(videoId: string) => string} [youtube.canonicalYoutubeUrl]
 * @returns {{
 *   parseRichText: (text: string, contentType?: string) => object[],
 *   toPlainText: (text: string, contentType?: string) => string,
 * }}
 */
export function createRichText(MarkdownIt, { youtubeVideoId, canonicalYoutubeUrl } = {}) {
    const markdown = createMarkdown(MarkdownIt);
    const videos = typeof youtubeVideoId === "function"
        && typeof canonicalYoutubeUrl === "function";

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
            return markdownTree(markdown, source, videos ? youtubeVideoId : null);
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
        return blocksText(parseRichText(source, contentType), canonicalYoutubeUrl)
            .replace(/[ \t]+$/gmu, "");
    }

    return { parseRichText, toPlainText };
}
