// Builds DOM nodes from a rich text tree (#765). Text only ever goes into text
// nodes, and the only attribute set is an integer `start` on numbered lists,
// as canonical-schemas/rich-text/README.md requires.
//
// Until the teacher views get links and the video facade (#785), a link shows
// its text only and a video its title in a paragraph, so no text is lost.

const BLOCK_ELEMENTS = { paragraph: "p" };
const INLINE_ELEMENTS = { strong: "strong", emphasis: "em" };

function appendNodes(document, parent, nodes) {
    for (const node of nodes) {
        if (node.type === "link") {
            appendNodes(document, parent, node.children);
        } else {
            parent.appendChild(buildNode(document, node));
        }
    }
    return parent;
}

// An item with a single paragraph, nested lists aside, shows that paragraph's
// text directly in the <li>, as CommonMark renders tight lists. Items with
// several paragraphs keep their <p> elements.
function buildListItem(document, item) {
    const element = document.createElement("li");
    const paragraphs = item.children.filter(child => child.type === "paragraph");
    for (const child of item.children) {
        if (paragraphs.length === 1 && child.type === "paragraph") {
            appendNodes(document, element, child.children);
        } else {
            element.appendChild(buildNode(document, child));
        }
    }
    return element;
}

function buildList(document, list) {
    const element = document.createElement(list.ordered ? "ol" : "ul");
    if (list.ordered && Number.isInteger(list.start) && list.start !== 1) {
        element.setAttribute("start", String(list.start));
    }
    for (const item of list.items) {
        element.appendChild(buildListItem(document, item));
    }
    return element;
}

function buildNode(document, node) {
    if (node.type === "text") {
        return document.createTextNode(node.value);
    }
    if (node.type === "break") {
        return document.createElement("br");
    }
    if (node.type === "list") {
        return buildList(document, node);
    }
    if (node.type === "video") {
        const paragraph = document.createElement("p");
        paragraph.appendChild(document.createTextNode(node.title));
        return paragraph;
    }
    const tag = BLOCK_ELEMENTS[node.type] || INLINE_ELEMENTS[node.type];
    if (!tag) {
        return document.createTextNode("");
    }
    return appendNodes(document, document.createElement(tag), node.children);
}

/** A DocumentFragment with the tree's blocks, built with `document`. */
export function buildRichTextFragment(document, tree) {
    const blocks = Array.isArray(tree) ? tree : [];
    return appendNodes(document, document.createDocumentFragment(), blocks);
}
