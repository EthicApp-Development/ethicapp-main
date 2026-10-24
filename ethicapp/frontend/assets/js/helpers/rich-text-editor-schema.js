// The editor's document model (#767): exactly the rich text subset of
// canonical-schemas/rich-text/README.md. Pasted HTML is parsed against it, so
// anything else (underline, colors, fonts, headings, links, tables) is dropped
// and its text kept.
//
// A case video (#787) is an atom block, allowed only at the top level, as the
// contract's `video` blocks are. The editor draws its card with a node view;
// `toDOM` and `parseDOM` only carry it through copy and paste.

import { Schema } from "prosemirror-model";
import { isYoutubeVideoId } from "../../../../common/modules/youtube-urls.js";

const BOLD_WEIGHT = /^(bold(er)?|[5-9]\d{2,})$/u;
const VIDEO_ID_ATTRIBUTE = "data-rich-text-editor-video-id";
const VIDEO_TITLE_ATTRIBUTE = "data-rich-text-editor-video-title";

export const richTextSchema = new Schema({
    nodes: {
        doc: { content: "(block | video)+" },

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

        video: {
            attrs:      { videoId: {}, title: { default: "" } },
            atom:       true,
            selectable: true,
            draggable:  false,
            parseDOM:   [{
                tag:      `div[${VIDEO_ID_ATTRIBUTE}]`,
                getAttrs: dom => {
                    const videoId = dom.getAttribute(VIDEO_ID_ATTRIBUTE);
                    return isYoutubeVideoId(videoId)
                        ? { videoId, title: dom.getAttribute(VIDEO_TITLE_ATTRIBUTE) || "" }
                        : false;
                },
            }],
            toDOM: node => ["div", {
                [VIDEO_ID_ATTRIBUTE]:    node.attrs.videoId,
                [VIDEO_TITLE_ATTRIBUTE]: node.attrs.title,
            }],
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
