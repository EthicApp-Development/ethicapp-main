// The case's videos as complementary material below the case document (#788,
// epic #779), in the case's order. Nothing shows for a case without videos.

import { CASE_MATERIAL_DISPLAY, caseMaterialVideos } from "../helpers/case-video-material.js";

let instanceCount = 0;

function CaseVideoMaterialController() {
    const vm = this;
    instanceCount += 1;
    const idPrefix = `case-material-${instanceCount}`;

    vm.videos = [];
    vm.expanded = {};
    vm.headingId = `${idPrefix}-heading`;
    vm.display = CASE_MATERIAL_DISPLAY;

    vm.$onChanges = function(changes) {
        if (changes.caseItem) {
            vm.videos = caseMaterialVideos(vm.caseItem);
            vm.expanded = {};
        }
    };

    vm.descriptionId = function(video) {
        return `${idPrefix}-description-${video.youtubeVideoId}`;
    };

    vm.isCollapsed = function(video) {
        return video.hasLongDescription && !vm.expanded[video.youtubeVideoId];
    };

    vm.toggleDescription = function(video) {
        vm.expanded[video.youtubeVideoId] = !vm.expanded[video.youtubeVideoId];
    };
}

export default {
    bindings: {
        caseItem: "<",
    },
    controller:  CaseVideoMaterialController,
    templateUrl: "/assets/static/views/teacher/fragments/case-video-material.template.html",
};
