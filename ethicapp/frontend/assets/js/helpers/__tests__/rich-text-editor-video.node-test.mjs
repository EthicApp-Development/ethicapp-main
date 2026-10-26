import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";

import { richTextSchema as schema } from "../rich-text-editor-schema.js";
import { docFromText, markdownFromDoc } from "../rich-text-markdown.js";
import {
    VideoCardView, insertVideo, trailingParagraphPlugin, withTrailingParagraph,
} from "../rich-text-editor-video.js";

const MARKDOWN = "text/markdown";
const ID = "M7lc1UVf-VE";
const URL_OF = id => `https://www.youtube.com/watch?v=${id}`;
const CHOICE = { videoId: ID, title: "Intro" };
const VIDEO_MARKDOWN = `[Intro](${URL_OF(ID)})`;

const {
    paragraph, bullet_list: bulletList, list_item: listItem, video, doc,
} = schema.nodes;
const text = value => schema.text(value);
const p = (...content) => paragraph.create(null, content);

function stateOf(document, selection) {
    const state = EditorState.create({ doc: document, plugins: [trailingParagraphPlugin] });
    return selection ? state.apply(state.tr.setSelection(selection(state.doc))) : state;
}

// Runs a command and returns the state it leads to.
function run(state, command) {
    let next = state;
    const handled = command(state, tr => {
        next = state.apply(tr);
    });
    return { handled, state: next };
}

function cursorAt(position) {
    return document => TextSelection.create(document, position);
}

describe("inserting a case video in the editor (#787)", () => {
    it("splits a paragraph at the cursor", () => {
        // "Antes|después": position 6 is after "Antes".
        const state = stateOf(doc.create(null, [p(text("Antesdespués"))]), cursorAt(6));
        const { handled, state: next } = run(state, insertVideo(CHOICE));
        assert.equal(handled, true);
        assert.equal(markdownFromDoc(next.doc), `Antes\n\n${VIDEO_MARKDOWN}\n\ndespués`);
        // The cursor goes to the start of the text after the video.
        assert.equal(next.selection.$from.parent.textContent, "después");
        assert.equal(next.selection.$from.parentOffset, 0);
    });

    it("goes before or after a paragraph when the cursor is at its edges", () => {
        const document = doc.create(null, [p(text("Uno"))]);
        const before = run(stateOf(document, cursorAt(1)), insertVideo(CHOICE)).state;
        assert.equal(markdownFromDoc(before.doc), `${VIDEO_MARKDOWN}\n\nUno`);
        const after = run(stateOf(document, cursorAt(4)), insertVideo(CHOICE)).state;
        assert.equal(markdownFromDoc(after.doc), `Uno\n\n${VIDEO_MARKDOWN}`);
        // A paragraph follows a video that would end the document.
        assert.equal(after.doc.lastChild.type, paragraph);
        assert.ok(after.selection instanceof TextSelection);
        assert.equal(after.selection.$from.parent, after.doc.lastChild);
    });

    it("replaces an empty paragraph and selected text", () => {
        const empty = stateOf(doc.create(null, [p(text("Uno")), p(), p(text("Dos"))]),
            cursorAt(6));
        const { state: replaced } = run(empty, insertVideo(CHOICE));
        assert.equal(replaced.doc.childCount, 3);
        assert.equal(replaced.doc.child(1).type, video);

        const selected = stateOf(doc.create(null, [p(text("Uno borrar dos"))]),
            document => TextSelection.create(document, 5, 11));
        const { state: next } = run(selected, insertVideo(CHOICE));
        assert.equal(markdownFromDoc(next.doc), `Uno\n\n${VIDEO_MARKDOWN}\n\ndos`);
    });

    it("goes after the list that holds the cursor, and after a selected video", () => {
        const list = bulletList.create(null, [listItem.create(null, [p(text("ítem"))])]);
        const inList = stateOf(doc.create(null, [list, p(text("Fin"))]), cursorAt(4));
        const { state: next } = run(inList, insertVideo(CHOICE));
        assert.equal(markdownFromDoc(next.doc), `- ítem\n\n${VIDEO_MARKDOWN}\n\nFin`);

        const second = { videoId: "dQw4w9WgXcQ", title: "Otro" };
        const onVideo = stateOf(next.doc,
            document => NodeSelection.create(document, list.nodeSize));
        const { state: afterVideo } = run(onVideo, insertVideo(second));
        assert.equal(markdownFromDoc(afterVideo.doc), `- ítem\n\n${VIDEO_MARKDOWN}\n\n`
            + `[Otro](${URL_OF("dQw4w9WgXcQ")})\n\nFin`);
    });

    it("goes at the end when asked, before a trailing empty paragraph", () => {
        const state = stateOf(doc.create(null, [p(text("Uno")), p()]), cursorAt(1));
        const { state: next } = run(state, insertVideo(CHOICE, { atEnd: true }));
        assert.equal(markdownFromDoc(next.doc), `Uno\n\n${VIDEO_MARKDOWN}`);
        assert.equal(next.doc.childCount, 3);
    });

    it("refuses malformed ids", () => {
        const state = stateOf(doc.create(null, [p(text("Uno"))]));
        assert.equal(run(state, insertVideo({ videoId: "nope", title: "x" })).handled, false);
        assert.equal(insertVideo(CHOICE)(state), true, "can run");
    });

    it("keeps a paragraph after a video that ends the document", () => {
        const loaded = docFromText(schema, `Uno\n\n${VIDEO_MARKDOWN}`, MARKDOWN);
        assert.equal(loaded.lastChild.type, video);
        const padded = withTrailingParagraph(loaded);
        assert.equal(padded.lastChild.type, paragraph);
        assert.equal(withTrailingParagraph(padded), padded);

        const state = stateOf(padded);
        const last = padded.lastChild;
        const next = state.apply(state.tr.delete(padded.content.size - last.nodeSize,
            padded.content.size));
        assert.equal(next.doc.lastChild.type, paragraph, "the plugin adds it back");
        assert.equal(markdownFromDoc(next.doc), markdownFromDoc(padded));
    });
});

// ─── The card ───────────────────────────────────────────────────────────────

// Just enough of a DOM for the card.
function fakeElement(document, tag) {
    const classes = new Set();
    const element = {
        tag,
        ownerDocument: document,
        attributes:    {},
        children:      [],
        listeners:     {},
        hidden:        false,
        textContent:   "",
        get className() {
            return [...classes].join(" ");
        },
        set className(value) {
            classes.clear();
            value.split(" ").filter(Boolean).forEach(name => classes.add(name));
        },
        classList: {
            toggle:   (name, on) => (on ? classes.add(name) : classes.delete(name)),
            contains: name => classes.has(name),
        },
        setAttribute(name, value) {
            this.attributes[name] = String(value);
        },
        appendChild(child) {
            this.children.push(child);
            return child;
        },
        append(...children) {
            children.forEach(child => this.children.push(child));
        },
        addEventListener(type, listener) {
            this.listeners[type] = listener;
        },
    };
    return element;
}

function fakeView(state) {
    const document = { activeElement: null };
    document.createElement = tag => fakeElement(document, tag);
    const view = {
        state,
        focused: false,
        dom:     { ownerDocument: document },
        dispatch(tr) {
            view.state = view.state.apply(tr);
        },
        focus() {
            view.focused = true;
        },
    };
    return view;
}

function findAll(element, predicate, found = []) {
    if (predicate(element)) {
        found.push(element);
    }
    (element.children || []).forEach(child => findAll(child, predicate, found));
    return found;
}

const byClass = name => element => element.classList?.contains(name);

describe("the video card (#787)", () => {
    const translate = key => `<${key}>`;

    function cardFor(title, status) {
        const document = doc.create(null, [p(text("Uno")),
            video.create({ videoId: ID, title }), p()]);
        const view = fakeView(EditorState.create({ doc: document }));
        const position = document.child(0).nodeSize;
        const card = new VideoCardView(document.child(1), view, () => position,
            { translate, status: () => status });
        return { card, view, position };
    }

    it("shows the title, the source, the duration and the warning", () => {
        const { card } = cardFor("Intro", { duration: "3:05", warningKey: "warn_key" });
        const [input] = findAll(card.dom, byClass("rich-text-editor-video-title"));
        assert.equal(input.value, "Intro");
        assert.equal(input.placeholder, URL_OF(ID));
        assert.equal(input.attributes["aria-label"], "<rich_text_editor_video_title_label>");
        assert.equal(card.dom.attributes["data-video-id"], ID);
        assert.equal(card.dom.attributes["aria-label"],
            "<rich_text_editor_video_card_label>: Intro");
        assert.ok(card.dom.classList.contains("has-warning"));
        const [duration] = findAll(card.dom, byClass("rich-text-editor-video-duration"));
        assert.equal(duration.textContent, "<case_videos_duration>: 3:05");
        assert.equal(duration.hidden, false);
        const [warning] = findAll(card.dom, byClass("rich-text-editor-video-warning"));
        assert.equal(warning.hidden, false);
        assert.ok(findAll(warning, node => node.textContent === "<warn_key>").length === 1);
        const [remove] = findAll(card.dom, byClass("rich-text-editor-video-remove"));
        assert.equal(remove.type, "button");
        assert.equal(remove.attributes["aria-label"], "<rich_text_editor_video_remove>: Intro");
    });

    it("hides what it does not know, and names an untitled video by its URL", () => {
        const { card } = cardFor("", { duration: "", warningKey: null });
        const [duration] = findAll(card.dom, byClass("rich-text-editor-video-duration"));
        const [warning] = findAll(card.dom, byClass("rich-text-editor-video-warning"));
        assert.equal(duration.hidden, true);
        assert.equal(warning.hidden, true);
        assert.equal(card.dom.classList.contains("has-warning"), false);
        assert.equal(card.dom.attributes["aria-label"],
            `<rich_text_editor_video_card_label>: ${URL_OF(ID)}`);
    });

    it("edits the title and removes the video", () => {
        const { card, view } = cardFor("Intro", { duration: "", warningKey: null });
        const [input] = findAll(card.dom, byClass("rich-text-editor-video-title"));
        input.value = "Nuevo *título*";
        input.listeners.change();
        assert.equal(view.state.doc.child(1).attrs.title, "Nuevo *título*");
        assert.equal(markdownFromDoc(view.state.doc),
            `Uno\n\n[Nuevo \\*título\\*](${URL_OF(ID)})`);

        card.update(view.state.doc.child(1));
        const [remove] = findAll(card.dom, byClass("rich-text-editor-video-remove"));
        remove.listeners.click();
        assert.equal(markdownFromDoc(view.state.doc), "Uno");
        assert.equal(view.focused, true);
    });

    it("lets its own controls handle their events", () => {
        const { card } = cardFor("Intro", { duration: "", warningKey: null });
        const control = { closest: selector => (selector === "input, button" ? {} : null) };
        assert.equal(card.stopEvent({ target: control }), true);
        assert.equal(card.stopEvent({ target: { closest: () => null } }), false);
        assert.equal(card.stopEvent({ target: card.dom }), false);
        assert.equal(card.ignoreMutation(), true);
        assert.equal(card.update(schema.nodes.paragraph.create()), false);
    });
});
