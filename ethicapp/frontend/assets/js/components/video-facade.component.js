// A YouTube video outside rich text (#788): the same click-to-load facade as
// the rich text videos (#785), built by buildVideoBlock from the validated id,
// or its unavailable notice. Nothing is requested from YouTube or Google until
// the facade is activated, by click or by Enter or Space on its button.

import { activateVideoFacade, buildVideoBlock } from "../helpers/rich-text-dom.js";
import { isYoutubeVideoId } from "../../../../common/modules/youtube-urls.js";

function VideoFacadeController($element, $rootScope, $translate) {
    const vm = this;
    const host = $element[0];

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
        if (!isYoutubeVideoId(vm.videoId)) {
            host.replaceChildren();
            return;
        }
        host.replaceChildren(buildVideoBlock(host.ownerDocument, {
            videoId:  vm.videoId,
            title:    vm.videoTitle || "",
            metadata: vm.metadata || null,
        }, builtLabels));
    }

    // Build again once translations load or the language changes, which also
    // resets a playing video.
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
        videoId:    "<",
        videoTitle: "<",
        metadata:   "<",
    },
    controller: ["$element", "$rootScope", "$translate", VideoFacadeController],
};
