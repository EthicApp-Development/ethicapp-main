// The case's complementary material below the case document: its videos
// (#788, epic #779), then its Google Drive documents (#794, epic #789), each
// in the case's order. Nothing shows for a case without either.

import { CASE_DOCUMENT_DISPLAY, caseMaterialDocuments } from "../helpers/case-document-material.js";
import { CASE_MATERIAL_DISPLAY, caseMaterialVideos } from "../helpers/case-video-material.js";

let instanceCount = 0;

function CaseMaterialController() {
    const vm = this;
    instanceCount += 1;
    const idPrefix = `case-material-${instanceCount}`;

    vm.videos = [];
    vm.documents = [];
    vm.expanded = {};
    vm.headingId = `${idPrefix}-heading`;
    vm.display = CASE_MATERIAL_DISPLAY;
    vm.documentDisplay = CASE_DOCUMENT_DISPLAY;

    vm.$onChanges = function(changes) {
        if (changes.caseItem) {
            vm.videos = caseMaterialVideos(vm.caseItem);
            vm.documents = caseMaterialDocuments(vm.caseItem);
            vm.expanded = {};
        }
    };

    vm.hasMaterial = function() {
        return vm.videos.length > 0 || vm.documents.length > 0;
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
    controller:  CaseMaterialController,
    templateUrl: "/assets/static/views/teacher/fragments/case-material.template.html",
};
