// A limited rich text editor for teacher-written texts (#767): bold, italic,
// bulleted and numbered lists, line breaks and clear formatting. It loads
// text by its content type and reports every change as text/markdown, in the
// CommonMark subset of canonical-schemas/rich-text/README.md.
//
// Bindings: `text` and `contentType` (one-way: the parent stores what
// `onChange({ text, contentType })` reports), `label` and `placeholder` for
// the editable area, and `invalid` for the warning style.
//
// `videos` (#787) takes the case's videos (`GET /cases/:id`). When it holds
// any, the toolbar offers "Insert a case video", which opens a dialog to
// choose one. Video cards show their duration from it, and warn about videos
// it does not hold. Leave it unset where the case is unknown.

import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { history, redo, undo } from "prosemirror-history";
import { liftListItem, sinkListItem, splitListItem, wrapInList } from "prosemirror-schema-list";

import { richTextSchema as schema } from "../helpers/rich-text-editor-schema.js";
import { docFromText, markdownFromDoc } from "../helpers/rich-text-markdown.js";
import {
    VideoCardView, insertVideo, trailingParagraphPlugin, withTrailingParagraph,
} from "../helpers/rich-text-editor-video.js";
import { embeddedVideoStatus } from "../helpers/case-video-embeds.js";

const TEXT_MARKDOWN = "text/markdown";
const {
    bullet_list: bulletList, ordered_list: orderedList, list_item: listItem, hard_break: hardBreak,
} = schema.nodes;

function enclosingList(state) {
    const { $from } = state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
        const node = $from.node(depth);
        if (node.type === bulletList || node.type === orderedList) {
            return { node, position: $from.before(depth) };
        }
    }
    return null;
}

// Wraps the selection in a list of `type`, lifts it out of one, or switches
// the enclosing list's kind.
function toggleList(type) {
    return (state, dispatch) => {
        const list = enclosingList(state);
        if (!list) {
            return wrapInList(type)(state, dispatch);
        }
        if (list.node.type === type) {
            return liftListItem(listItem)(state, dispatch);
        }
        if (dispatch) {
            const attrs = type === orderedList ? { order: 1 } : null;
            dispatch(state.tr.setNodeMarkup(list.position, type, attrs));
        }
        return true;
    };
}

function clearFormatting(state, dispatch) {
    const { from, to, empty } = state.selection;
    if (dispatch) {
        const tr = empty ? state.tr.setStoredMarks([]) : state.tr;
        if (!empty) {
            Object.values(schema.marks).forEach(mark => tr.removeMark(from, to, mark));
        }
        dispatch(tr);
    }
    return true;
}

function insertHardBreak(state, dispatch) {
    if (dispatch) {
        dispatch(state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView());
    }
    return true;
}

function isMarkActive(state, type) {
    const { from, to, empty, $from } = state.selection;
    if (empty) {
        return Boolean(type.isInSet(state.storedMarks || $from.marks()));
    }
    return state.doc.rangeHasMark(from, to, type);
}

const COMMANDS = {
    bold:         toggleMark(schema.marks.strong),
    italic:       toggleMark(schema.marks.em),
    bulletList:   toggleList(bulletList),
    numberedList: toggleList(orderedList),
    clear:        clearFormatting,
};

function createState(text, contentType) {
    return EditorState.create({
        doc:     withTrailingParagraph(docFromText(schema, text, contentType)),
        plugins: [
            trailingParagraphPlugin,
            history(),
            keymap({
                "Mod-b":       COMMANDS.bold,
                "Mod-i":       COMMANDS.italic,
                "Mod-z":       undo,
                "Shift-Mod-z": redo,
                "Mod-y":       redo,
                "Shift-Enter": insertHardBreak,
                "Enter":       splitListItem(listItem),
                // Only inside lists: elsewhere Tab keeps moving the focus.
                "Tab":         sinkListItem(listItem),
                "Shift-Tab":   liftListItem(listItem),
            }),
            keymap(baseKeymap),
        ],
    });
}

function RichTextEditorController($element, $scope, $rootScope, $translate,
    CaseVideoPickerService) {
    const vm = this;
    let view = null;
    let lastEmitted;
    let stopListening = null;
    // Whether the teacher has placed the cursor in the current text.
    let hasCursor = false;

    vm.active = {};
    vm.shortcutKey = /Mac|iPhone|iPad/u.test(globalThis.navigator?.platform ?? "") ? "⌘" : "Ctrl+";

    // A new object each time, so that setting it redraws every video card.
    function nodeViews() {
        const context = {
            translate: key => $translate.instant(key),
            status:    videoId => embeddedVideoStatus(vm.videos, videoId),
        };
        return {
            video: (node, editorView, getPos) => new VideoCardView(node, editorView, getPos,
                context),
        };
    }

    function attributes(state) {
        const { firstChild } = state.doc;
        const isEmpty = state.doc.childCount === 1 && firstChild.isTextblock
            && firstChild.content.size === 0;
        const emptyClass = isEmpty ? " is-empty" : "";
        return {
            "class":            `form-control rich-text-editor-content${emptyClass}`,
            "role":             "textbox",
            "aria-multiline":   "true",
            "aria-label":       vm.label || "",
            "data-placeholder": vm.placeholder || "",
        };
    }

    function refreshToolbar(state) {
        const list = enclosingList(state);
        vm.active = {
            bold:         isMarkActive(state, schema.marks.strong),
            italic:       isMarkActive(state, schema.marks.em),
            bulletList:   list?.node.type === bulletList,
            numberedList: list?.node.type === orderedList,
        };
    }

    vm.run = function(name) {
        if (!view) {
            return;
        }
        COMMANDS[name](view.state, view.dispatch, view);
        view.focus();
    };

    vm.hasVideos = function() {
        return Array.isArray(vm.videos) && vm.videos.length > 0;
    };

    // Inserts the chosen video at the cursor, or at the end when the text was
    // never focused, so it has no cursor of the teacher's. Dismissing the
    // dialog gives the focus back to where it was.
    vm.openVideoDialog = function() {
        if (!view || !vm.hasVideos()) {
            return;
        }
        const atEnd = !hasCursor;
        CaseVideoPickerService.open(vm.videos).then(choice => {
            if (!view || !choice) {
                return;
            }
            insertVideo(choice, { atEnd })(view.state, view.dispatch);
            view.focus();
        }, () => {});
    };

    function redrawVideoCards() {
        view?.setProps({ nodeViews: nodeViews() });
    }

    vm.$postLink = function() {
        lastEmitted = vm.text;
        view = new EditorView($element[0].querySelector(".rich-text-editor-host"), {
            state:           createState(vm.text, vm.contentType),
            nodeViews:       nodeViews(),
            attributes,
            handleDOMEvents: {
                focus() {
                    hasCursor = true;
                    return false;
                },
            },
            dispatchTransaction(transaction) {
                const state = view.state.apply(transaction);
                view.updateState(state);
                $scope.$evalAsync(() => {
                    refreshToolbar(state);
                    if (!transaction.docChanged) {
                        return;
                    }
                    const text = markdownFromDoc(state.doc);
                    if (text !== lastEmitted) {
                        lastEmitted = text;
                        vm.onChange({ text, contentType: TEXT_MARKDOWN });
                    }
                });
            },
        });
        refreshToolbar(view.state);
        // Card labels are read when cards are drawn: draw them again once
        // translations load or the language changes.
        stopListening = $rootScope.$on("$translateChangeEnd", redrawVideoCards);
    };

    vm.$onChanges = function(changes) {
        if (!view) {
            return;
        }
        // Reload only for text that did not come from this editor.
        if (changes.text && changes.text.currentValue !== lastEmitted) {
            lastEmitted = changes.text.currentValue;
            hasCursor = false;
            view.updateState(createState(vm.text, vm.contentType));
            refreshToolbar(view.state);
        }
        if (changes.label || changes.placeholder) {
            view.setProps({ attributes });
        }
        if (changes.videos) {
            redrawVideoCards();
        }
    };

    vm.$onDestroy = function() {
        stopListening?.();
        view?.destroy();
        view = null;
    };
}

const BUTTONS = [
    { name: "bold", icon: "fa-bold", label: "rich_text_bold", shortcut: "B" },
    { name: "italic", icon: "fa-italic", label: "rich_text_italic", shortcut: "I" },
    { name: "bulletList", icon: "fa-list-ul", label: "rich_text_bullet_list" },
    { name: "numberedList", icon: "fa-list-ol", label: "rich_text_numbered_list" },
    { name: "clear", icon: "fa-eraser", label: "rich_text_clear_formatting" },
];

function toolbarButton({ name, icon, label, shortcut }) {
    const title = shortcut
        ? `{{ '${label}' | translate }} ({{ $ctrl.shortcutKey }}${shortcut})`
        : `{{ '${label}' | translate }}`;
    // "Clear formatting" is an action, not a state: it has no pressed state.
    const pressed = name === "clear"
        ? ""
        : `aria-pressed="{{ $ctrl.active.${name} ? 'true' : 'false' }}"
                ng-class="{ active: $ctrl.active.${name} }"`;
    return `
            <button type="button" class="btn btn-default btn-sm" title="${title}"
                ${pressed}
                ng-mousedown="$event.preventDefault()"
                ng-click="$ctrl.run('${name}')">
                <i class="fa-solid ${icon}" aria-hidden="true"></i>
                <span class="sr-only">{{ '${label}' | translate }}</span>
            </button>`;
}

const richTextEditorComponent = {
    bindings: {
        text:        "<",
        contentType: "<",
        label:       "@",
        placeholder: "@",
        invalid:     "<",
        videos:      "<?",
        onChange:    "&",
    },
    template: `
    <div class="rich-text-editor" ng-class="{ 'rich-text-editor-invalid': $ctrl.invalid }">
        <div class="btn-toolbar rich-text-editor-toolbar" role="toolbar"
            aria-label="{{ 'rich_text_toolbar_label' | translate }}">
            <div class="btn-group" role="group">${BUTTONS.slice(0, 2).map(toolbarButton).join("")}
            </div>
            <div class="btn-group" role="group">${BUTTONS.slice(2, 4).map(toolbarButton).join("")}
            </div>
            <div class="btn-group" role="group">${BUTTONS.slice(4).map(toolbarButton).join("")}
            </div>
            <div class="btn-group" role="group" ng-if="$ctrl.hasVideos()">
                <button type="button" class="btn btn-default btn-sm rich-text-editor-insert-video"
                    aria-haspopup="dialog"
                    ng-mousedown="$event.preventDefault()"
                    ng-click="$ctrl.openVideoDialog()">
                    <i class="fa-solid fa-film" aria-hidden="true"></i>
                    {{ 'rich_text_editor_video_insert' | translate }}
                </button>
            </div>
        </div>
        <div class="rich-text-editor-host"></div>
    </div>
    `,
    controller: [
        "$element", "$scope", "$rootScope", "$translate", "CaseVideoPickerService",
        RichTextEditorController,
    ],
};

export default richTextEditorComponent;
