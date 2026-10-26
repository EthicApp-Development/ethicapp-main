// A teacher-written text, rendered by its content type (#765): text/markdown as
// the CommonMark subset, anything else as plain text that keeps its line
// breaks. See canonical-schemas/rich-text/README.md.
//
// Videos (#785) render as a facade; activating it, by click or by Enter or
// Space on its button, replaces it with the YouTube player. `videos` takes the
// case's videos, when the view has the case, for durations and availability.

import { parseRichText } from "../helpers/rich-text.js";
import { activateVideoFacade, buildRichTextFragment } from "../helpers/rich-text-dom.js";

function RichTextController($element, $rootScope, $translate) {
    const vm = this;
    const host = $element[0];

    // Styles target the class: a type selector would lose on specificity.
    $element.addClass("rich-text");

    function labels() {
        return {
            playVideo:        $translate.instant("rich_text_video_play"),
            videoUnavailable: $translate.instant("rich_text_video_unavailable"),
            opensInNewTab:    $translate.instant("rich_text_link_new_tab"),
        };
    }

    let builtLabels = null;

    function render() {
        builtLabels = labels();
        const tree = parseRichText(vm.text, vm.contentType);
        host.replaceChildren(buildRichTextFragment(host.ownerDocument, tree, {
            videos: vm.videos,
            labels: builtLabels,
        }));
    }

    // Labels are read when the text is built: build again once translations
    // load or the language changes, which would also reset a playing video.
    function renderIfLabelsChanged() {
        const current = labels();
        if (Object.keys(current).some(key => current[key] !== builtLabels?.[key])) {
            render();
        }
    }

    function playVideo(event) {
        activateVideoFacade(host, event.target);
    }

    let stopListening = null;

    vm.$onChanges = render;

    vm.$postLink = function() {
        host.addEventListener("click", playVideo);
        stopListening = $rootScope.$on("$translateChangeEnd", renderIfLabelsChanged);
    };

    vm.$onDestroy = function() {
        host.removeEventListener("click", playVideo);
        stopListening?.();
    };
}

export default {
    bindings: {
        text:        "<",
        contentType: "<",
        videos:      "<",
    },
    controller: ["$element", "$rootScope", "$translate", RichTextController],
};
