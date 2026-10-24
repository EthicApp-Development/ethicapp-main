// The "Insert a case video" dialog of the design editor (#787). It lists the
// case's videos with their title, duration, channel, description excerpt and
// availability, and resolves with the chosen `{ videoId, title }`. Dismissing
// it rejects, as `$uibModal` does.
import { caseVideoChoices } from "../helpers/case-video-embeds.js";

const TEMPLATE_URL = "/assets/static/views/teacher/fragments/case-video-picker-modal.template.html";

function CaseVideoPickerModalController($uibModalInstance, videos) {
    const $ctrl = this;
    $ctrl.choices = caseVideoChoices(videos);
    $ctrl.expanded = {};

    $ctrl.isCollapsed = function(choice) {
        return choice.longDescription && !$ctrl.expanded[choice.videoId];
    };

    $ctrl.toggleDescription = function(choice) {
        $ctrl.expanded[choice.videoId] = !$ctrl.expanded[choice.videoId];
    };

    $ctrl.choose = function(choice) {
        if (!choice?.selectable) {
            return;
        }
        $uibModalInstance.close({ videoId: choice.videoId, title: choice.title });
    };

    $ctrl.cancel = function() {
        $uibModalInstance.dismiss("cancel");
    };
}

export function CaseVideoPickerService($uibModal) {
    return {
        /** Opens the dialog for the case's `videos`; resolves with the choice. */
        open(videos) {
            return $uibModal.open({
                templateUrl:    TEMPLATE_URL,
                controller:     ["$uibModalInstance", "videos", CaseVideoPickerModalController],
                controllerAs:   "$ctrl",
                ariaLabelledBy: "caseVideoPickerTitle",
                windowClass:    "case-video-picker",
                resolve:        {
                    videos: () => videos,
                },
            }).result;
        },
    };
}
