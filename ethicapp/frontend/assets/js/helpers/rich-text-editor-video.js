// Case videos in the rich text editor (#787): the command that inserts one,
// the plugin that keeps a paragraph after the last video, and the node view
// that draws a video as a card.
//
// A video is a top-level atom block (rich-text-editor-schema.js). Its card
// shows an editable title, the "YouTube" label, the duration when the case
// knows it, a warning when the case does not hold the video or YouTube reports
// it unavailable, and a remove button. Keyboard users can also select the card
// with the arrow keys and delete it with Backspace or Delete.

import { NodeSelection, Plugin, Selection } from "prosemirror-state";
import { canonicalYoutubeUrl, isYoutubeVideoId } from "../../../../common/modules/youtube-urls.js";

// ─── Commands ───────────────────────────────────────────────────────────────

// A document ending with a video gets an empty paragraph after it, so there
// is always somewhere to type after the last video.
function appendTrailingParagraph(tr) {
    const { video, paragraph } = tr.doc.type.schema.nodes;
    if (tr.doc.lastChild?.type === video) {
        tr.insert(tr.doc.content.size, paragraph.create());
    }
    return tr;
}

/** `doc`, with an empty paragraph after it when it ends with a video. */
export function withTrailingParagraph(doc) {
    const { video, paragraph } = doc.type.schema.nodes;
    return doc.lastChild?.type === video
        ? doc.copy(doc.content.addToEnd(paragraph.create()))
        : doc;
}

/** Keeps an empty paragraph after a video that ends the document. */
export const trailingParagraphPlugin = new Plugin({
    appendTransaction(transactions, _oldState, state) {
        if (!transactions.some(tr => tr.docChanged)) {
            return null;
        }
        const tr = appendTrailingParagraph(state.tr);
        return tr.docChanged ? tr : null;
    },
});

// Where the video goes, as a position between top-level blocks. Within a
// top-level paragraph it goes at the cursor, splitting the paragraph when
// the cursor is in the middle, or in place of the paragraph when it is empty
// (`replace`). Anywhere else it goes after the top-level block that holds the
// selection, since videos are top-level blocks only.
function insertionPoint(tr, atEnd, deleted = false) {
    const { doc, selection } = tr;
    if (atEnd) {
        const last = doc.lastChild;
        const emptyLast = last?.type.name === "paragraph" && last.content.size === 0;
        return { position: doc.content.size - (emptyLast ? last.nodeSize : 0) };
    }
    const { $from } = selection;
    if ($from.depth === 0) {
        return { position: selection.to };
    }
    if (selection instanceof NodeSelection || $from.depth > 1 || !$from.parent.isTextblock
        || (deleted && !selection.empty)) {
        return { position: $from.after(1) };
    }
    if (!selection.empty) {
        tr.deleteSelection();
        return insertionPoint(tr, false, true);
    }
    const paragraph = $from.parent;
    if (paragraph.content.size === 0) {
        return { position: $from.before(1), replace: true };
    }
    if ($from.parentOffset === 0) {
        return { position: $from.before(1) };
    }
    if ($from.parentOffset === paragraph.content.size) {
        return { position: $from.after(1) };
    }
    tr.split($from.pos);
    return { position: $from.pos + 1 };
}

/**
 * A command that inserts the video `{ videoId, title }` at the selection, or
 * at the end of the document with `atEnd`, and moves the cursor after it.
 */
export function insertVideo({ videoId, title } = {}, { atEnd = false } = {}) {
    return (state, dispatch) => {
        const { video } = state.schema.nodes;
        if (!video || !isYoutubeVideoId(videoId)) {
            return false;
        }
        if (!dispatch) {
            return true;
        }
        const node = video.create({ videoId, title: typeof title === "string" ? title : "" });
        const tr = state.tr;
        const { position, replace } = insertionPoint(tr, atEnd);
        if (replace) {
            tr.replaceWith(position, position + tr.doc.nodeAt(position).nodeSize, node);
        } else {
            tr.insert(position, node);
        }
        appendTrailingParagraph(tr);
        tr.setSelection(Selection.near(tr.doc.resolve(position + node.nodeSize), 1));
        dispatch(tr.scrollIntoView());
        return true;
    };
}

// ─── The card ───────────────────────────────────────────────────────────────

function element(document, tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}

function icon(document, className) {
    const node = element(document, "i", className);
    node.setAttribute("aria-hidden", "true");
    return node;
}

/**
 * The node view of a video. `context.translate(key)` gives translated labels,
 * and `context.status(videoId)` what `embeddedVideoStatus` of
 * case-video-embeds.js reports for it.
 */
export class VideoCardView {
    constructor(node, view, getPos, context) {
        this.node = node;
        this.view = view;
        this.getPos = getPos;
        this.context = context;

        const document = view.dom.ownerDocument;
        this.dom = element(document, "div", "rich-text-editor-video");
        this.dom.setAttribute("role", "group");
        this.dom.setAttribute("data-video-id", node.attrs.videoId);
        this.dom.appendChild(icon(document, "fa-solid fa-film rich-text-editor-video-icon"));

        const body = element(document, "div", "rich-text-editor-video-body");
        this.titleInput = element(document, "input",
            "form-control input-sm rich-text-editor-video-title");
        this.titleInput.type = "text";
        this.titleInput.addEventListener("change", () => this.commitTitle());
        this.titleInput.addEventListener("keydown", event => this.onTitleKeydown(event));
        body.appendChild(this.titleInput);

        const meta = element(document, "div", "text-muted rich-text-editor-video-meta");
        this.sourceLabel = element(document, "span", "label label-default");
        this.duration = element(document, "span", "rich-text-editor-video-duration");
        meta.append(this.sourceLabel, this.duration);
        body.appendChild(meta);

        this.warning = element(document, "p", "text-warning rich-text-editor-video-warning");
        this.warningText = element(document, "span");
        this.warning.append(icon(document, "fa-solid fa-triangle-exclamation"), " ",
            this.warningText);
        body.appendChild(this.warning);
        this.dom.appendChild(body);

        this.removeButton = element(document, "button",
            "btn btn-default btn-sm rich-text-editor-video-remove");
        this.removeButton.type = "button";
        this.removeButton.appendChild(icon(document, "fa-solid fa-trash text-danger"));
        this.removeButton.addEventListener("click", () => this.remove());
        this.dom.appendChild(this.removeButton);

        this.render();
    }

    render() {
        const { translate, status } = this.context;
        const { videoId, title } = this.node.attrs;
        const shownTitle = title.trim() || canonicalYoutubeUrl(videoId);
        const { duration, warningKey } = status(videoId);

        this.dom.setAttribute("aria-label",
            `${translate("rich_text_editor_video_card_label")}: ${shownTitle}`);
        this.dom.classList.toggle("has-warning", Boolean(warningKey));
        if (this.titleInput.ownerDocument.activeElement !== this.titleInput) {
            this.titleInput.value = title;
        }
        this.titleInput.placeholder = canonicalYoutubeUrl(videoId);
        this.titleInput.setAttribute("aria-label", translate("rich_text_editor_video_title_label"));
        this.sourceLabel.textContent = translate("case_videos_source_youtube");
        this.duration.textContent = duration
            ? `${translate("case_videos_duration")}: ${duration}`
            : "";
        this.duration.hidden = !duration;
        this.warningText.textContent = warningKey ? translate(warningKey) : "";
        this.warning.hidden = !warningKey;
        const removeLabel = translate("rich_text_editor_video_remove");
        this.removeButton.title = removeLabel;
        this.removeButton.setAttribute("aria-label", `${removeLabel}: ${shownTitle}`);
    }

    commitTitle() {
        const position = this.getPos();
        const title = this.titleInput.value;
        if (typeof position !== "number" || title === this.node.attrs.title) {
            return;
        }
        this.view.dispatch(this.view.state.tr.setNodeMarkup(position, null, {
            ...this.node.attrs, title,
        }));
    }

    onTitleKeydown(event) {
        if (event.key === "Enter") {
            event.preventDefault();
            this.commitTitle();
            this.view.focus();
        } else if (event.key === "Escape") {
            event.preventDefault();
            this.titleInput.value = this.node.attrs.title;
            this.view.focus();
        }
    }

    remove() {
        const position = this.getPos();
        if (typeof position !== "number") {
            return;
        }
        this.view.dispatch(this.view.state.tr.delete(position, position + this.node.nodeSize));
        this.view.focus();
    }

    update(node) {
        if (node.type !== this.node.type) {
            return false;
        }
        this.node = node;
        this.render();
        return true;
    }

    // The title field and the remove button handle their own events.
    stopEvent(event) {
        const target = event.target;
        return target !== this.dom && Boolean(target?.closest?.("input, button"));
    }

    ignoreMutation() {
        return true;
    }
}
