// A teacher-written text, rendered by its content type (#765): text/markdown as
// the CommonMark subset, anything else as plain text that keeps its line
// breaks. See canonical-schemas/rich-text/README.md.

import { parseRichText } from "../helpers/rich-text.js";
import { buildRichTextFragment } from "../helpers/rich-text-dom.js";

function RichTextController($element) {
    const vm = this;

    // Styles target the class: a type selector would lose on specificity.
    $element.addClass("rich-text");

    vm.$onChanges = function() {
        const host = $element[0];
        const tree = parseRichText(vm.text, vm.contentType);
        host.replaceChildren(buildRichTextFragment(host.ownerDocument, tree));
    };
}

export default {
    bindings: {
        text:        "<",
        contentType: "<",
    },
    controller: ["$element", RichTextController],
};
