// The editor's document model (#767): exactly the rich text subset of
// canonical-schemas/rich-text/README.md. Pasted HTML is parsed against it, so
// anything else (underline, colors, fonts, headings, links, tables) is dropped
// and its text kept.

import { Schema } from "prosemirror-model";

const BOLD_WEIGHT = /^(bold(er)?|[5-9]\d{2,})$/u;

export const richTextSchema = new Schema({
    nodes: {
        doc: { content: "block+" },

        paragraph: {
            group:    "block",
            content:  "inline*",
            parseDOM: [{ tag: "p" }],
            toDOM:    () => ["p", 0],
        },

        bullet_list: {
            group:    "block",
            content:  "list_item+",
            parseDOM: [{ tag: "ul" }],
            toDOM:    () => ["ul", 0],
        },

        ordered_list: {
            group:    "block",
            content:  "list_item+",
            attrs:    { order: { default: 1 } },
            parseDOM: [{
                tag:      "ol",
                getAttrs: dom => {
                    const start = Number(dom.getAttribute("start"));
                    return { order: Number.isInteger(start) && start >= 0 ? start : 1 };
                },
            }],
            toDOM: node => (node.attrs.order === 1
                ? ["ol", 0]
                : ["ol", { start: node.attrs.order }, 0]),
        },

        list_item: {
            content:  "paragraph block*",
            defining: true,
            parseDOM: [{ tag: "li" }],
            toDOM:    () => ["li", 0],
        },

        text: { group: "inline" },

        hard_break: {
            inline:     true,
            group:      "inline",
            selectable: false,
            parseDOM:   [{ tag: "br" }],
            toDOM:      () => ["br"],
        },
    },

    marks: {
        strong: {
            parseDOM: [
                { tag: "strong" },
                // Google Docs wraps pasted text in <b style="font-weight:normal">.
                { tag: "b", getAttrs: dom => dom.style.fontWeight !== "normal" && null },
                { style: "font-weight", getAttrs: value => BOLD_WEIGHT.test(value) && null },
            ],
            toDOM: () => ["strong", 0],
        },

        em: {
            parseDOM: [{ tag: "em" }, { tag: "i" }, { style: "font-style=italic" }],
            toDOM:    () => ["em", 0],
        },
    },
});
