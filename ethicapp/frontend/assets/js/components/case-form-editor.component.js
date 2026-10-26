import {
    MAX_CASE_VIDEOS,
    addCaseVideo,
    caseVideoFromPreview,
    caseVideoWarningKey,
    checkCaseVideoId,
    checkCaseVideoUrl,
    formatVideoDuration,
    isLongVideoDescription,
    moveCaseVideo,
    previewErrorMessageKey,
    removeCaseVideo,
} from "../helpers/case-videos-form.js";
import { moveFocusDirection } from "../helpers/ordered-list.js";

const CaseFormEditorController = function($scope, $window, $timeout, $translate,
    CasesCatalogService) {
    const vm = this;
    // Answers to an earlier preview request are ignored once another starts.
    let previewRequestId = 0;

    vm.$onInit = function() {
        vm.hasAttemptedSubmit = false;
        vm.ensureAuthors();
        vm.visibilityOptions = [
            { value: "private", labelKey: "visibility_private" },
            { value: "public", labelKey: "visibility_public" },
        ];
        vm.maxCaseVideos = MAX_CASE_VIDEOS;
        vm.videoSupport = "loading";
        vm.resetVideoInput();
        vm.loadVideoSupport();
    };

    vm.isLocked = function() {
        return vm.formModel?.hasLaunchedDesignActivity === true;
    };

    vm.onSubmit = function(form) {
        if (vm.isLocked()) {
            return;
        }

        vm.hasAttemptedSubmit = true;
        vm.ensureAuthors();
        if (!form || !vm.isFormValid(form) || vm.hasDuplicateAuthorEmails() || !vm.onSave) {
            return;
        }

        vm.clearUploadError();
        vm.onSave();
    };

    vm.isFormValid = function(form) {
        return form.$valid && !vm.hasMissingRequiredPdf();
    };

    vm.shouldShowError = function(control) {
        if (!control) {
            return false;
        }

        return control.$invalid && (control.$touched || vm.hasAttemptedSubmit);
    };

    vm.handlePdfSelected = function(files) {
        vm.clearUploadError();
        if (vm.onPdfSelected) {
            vm.onPdfSelected({ files });
        }
    };

    vm.clearUploadError = function() {
        if (vm.formModel) {
            vm.formModel.uploadErrorKey = "";
        }
    };

    vm.hasMissingRequiredPdf = function() {
        return vm.isPdfRequired && !vm.formModel?.pdf && !vm.formModel?.currentPdfPath;
    };

    vm.shouldShowPdfRequiredError = function(control) {
        return Boolean(
            (control && vm.shouldShowError(control) && control.$error.required) ||
            (vm.hasAttemptedSubmit && vm.hasMissingRequiredPdf())
        );
    };

    vm.hasUploadError = function() {
        return Boolean(vm.formModel?.uploadErrorKey);
    };

    vm.ensureAuthors = function() {
        if (!vm.formModel) {
            return;
        }

        if (!Array.isArray(vm.formModel.authors) || vm.formModel.authors.length === 0) {
            vm.formModel.authors = [{
                authorFirstname: "",
                authorLastname: "",
                authorEmail: "",
                isPrimary: true,
            }];
        }

        vm.formModel.authors.forEach((author, index) => {
            author.isPrimary = index === 0;
        });
    };

    vm.normalizeAuthorEmail = function(author) {
        return String(author?.authorEmail || "").trim().toLowerCase();
    };

    vm.getDuplicateAuthorEmailSet = function() {
        vm.ensureAuthors();
        const counts = new Map();
        vm.formModel.authors.forEach((author) => {
            const email = vm.normalizeAuthorEmail(author);
            if (email) {
                counts.set(email, (counts.get(email) || 0) + 1);
            }
        });

        return new Set(
            Array.from(counts.entries())
                .filter((entry) => entry[1] > 1)
                .map((entry) => entry[0])
        );
    };

    vm.hasDuplicateAuthorEmails = function() {
        return vm.getDuplicateAuthorEmailSet().size > 0;
    };

    vm.isDuplicateAuthorEmail = function(author) {
        const email = vm.normalizeAuthorEmail(author);
        return Boolean(email) && vm.getDuplicateAuthorEmailSet().has(email);
    };

    vm.addAuthor = function() {
        vm.ensureAuthors();
        vm.formModel.authors.push({
            authorFirstname: "",
            authorLastname: "",
            authorEmail: "",
            isPrimary: false,
        });
    };

    vm.removeAuthor = function(index) {
        vm.ensureAuthors();
        if (vm.formModel.authors.length <= 1) {
            return;
        }

        vm.formModel.authors.splice(index, 1);
        vm.ensureAuthors();
    };

    // Videos (#783) --------------------------------------------------------

    vm.loadVideoSupport = async function() {
        try {
            const support = await CasesCatalogService.getCaseVideoSupport();
            vm.videoSupport = support.enabled ? "enabled" : "disabled";
        } catch (error) {
            console.error("[caseFormEditor] Could not check video support.", error);
            vm.videoSupport = "error";
        }
        $scope.$applyAsync();
    };

    vm.resetVideoInput = function() {
        previewRequestId += 1;
        vm.videoUrl = "";
        vm.videoPreview = null;
        vm.videoPreviewErrorKey = "";
        vm.isPreviewingVideo = false;
        vm.isPreviewDescriptionExpanded = false;
    };

    vm.getVideos = function() {
        return Array.isArray(vm.formModel?.videos) ? vm.formModel.videos : [];
    };

    vm.getVideoSupportHelpKey = function() {
        if (vm.videoSupport === "disabled") {
            return "case_videos_not_configured";
        }
        if (vm.videoSupport === "error") {
            return "case_videos_support_error";
        }
        return "";
    };

    vm.isVideoSupportEnabled = function() {
        return vm.videoSupport === "enabled";
    };

    vm.isVideoToggleDisabled = function() {
        return vm.isLocked() || !vm.isVideoSupportEnabled();
    };

    // The list is editable unless the case is locked. Videos already in a
    // case can be reordered and removed even when support is not configured.
    vm.canEditVideos = function() {
        return !vm.isLocked();
    };

    vm.canAddVideos = function() {
        return vm.canEditVideos() && vm.isVideoSupportEnabled()
            && vm.getVideos().length < MAX_CASE_VIDEOS;
    };

    vm.isVideoListFull = function() {
        return vm.getVideos().length >= MAX_CASE_VIDEOS;
    };

    vm.areVideosShown = function() {
        return vm.formModel?.includesVideos === true || vm.getVideos().length > 0;
    };

    vm.onIncludesVideosChange = function() {
        if (vm.formModel.includesVideos || vm.getVideos().length === 0) {
            vm.resetVideoInput();
            return;
        }

        const message = $translate.instant("case_videos_remove_all_confirmation", {
            count: vm.getVideos().length,
        });
        if (!$window.confirm(message)) {
            vm.formModel.includesVideos = true;
            return;
        }

        vm.formModel.videos = [];
        vm.formModel.videoFieldErrors = {};
        vm.resetVideoInput();
    };

    vm.onVideoUrlKeydown = function(event) {
        // Enter previews the video instead of submitting the case form.
        if (event.key === "Enter" && !event.isComposing) {
            event.preventDefault();
            vm.previewVideo();
        }
    };

    // Editing the URL drops its preview, and any preview still on its way.
    vm.onVideoUrlChange = function() {
        previewRequestId += 1;
        vm.isPreviewingVideo = false;
        vm.videoPreview = null;
        vm.videoPreviewErrorKey = "";
    };

    vm.previewVideo = async function() {
        if (!vm.canAddVideos() || vm.isPreviewingVideo) {
            return;
        }

        vm.videoPreview = null;
        vm.isPreviewDescriptionExpanded = false;
        const check = checkCaseVideoUrl(vm.getVideos(), vm.videoUrl);
        if (!check.ok) {
            vm.videoPreviewErrorKey = check.errorKey;
            return;
        }

        vm.videoPreviewErrorKey = "";
        vm.isPreviewingVideo = true;
        previewRequestId += 1;
        const requestId = previewRequestId;
        try {
            const preview = await CasesCatalogService.previewCaseVideo(vm.videoUrl.trim());
            if (requestId !== previewRequestId) {
                return;
            }
            vm.videoPreview = caseVideoFromPreview(preview);
            vm.announceVideos(vm.videoPreview, "case_videos_preview_ready_announcement");
        } catch (error) {
            if (requestId !== previewRequestId) {
                return;
            }
            vm.videoPreviewErrorKey = previewErrorMessageKey(error);
        } finally {
            if (requestId === previewRequestId) {
                vm.isPreviewingVideo = false;
            }
            $scope.$applyAsync();
        }
    };

    vm.confirmVideoPreview = function() {
        const video = vm.videoPreview;
        if (!video || !vm.canAddVideos()) {
            return;
        }

        const check = checkCaseVideoId(vm.getVideos(), video.youtubeVideoId);
        if (!check.ok) {
            vm.videoPreviewErrorKey = check.errorKey;
            vm.videoPreview = null;
            return;
        }

        vm.formModel.videos = addCaseVideo(vm.getVideos(), video);
        vm.formModel.includesVideos = true;
        vm.resetVideoInput();
        vm.announceVideos(video, "case_videos_added_announcement");
        vm.focusElement("caseVideoUrl");
    };

    vm.discardVideoPreview = function() {
        vm.resetVideoInput();
        vm.focusElement("caseVideoUrl");
    };

    vm.moveVideo = function(index, offset) {
        if (!vm.canEditVideos()) {
            return;
        }

        const videos = vm.getVideos();
        const moved = moveCaseVideo(videos, index, offset);
        if (moved === videos) {
            return;
        }

        const video = videos[index];
        const position = index + offset;
        vm.formModel.videos = moved;
        vm.announceVideos(video, "case_videos_moved_announcement", {
            position: position + 1,
            count:    moved.length,
        });
        // Keeps the keyboard on the moved video.
        vm.focusElement(vm.getVideoControlId(video,
            moveFocusDirection(offset, position, moved.length)));
    };

    vm.removeVideo = function(index) {
        if (!vm.canEditVideos()) {
            return;
        }

        const video = vm.getVideos()[index];
        if (!video) {
            return;
        }

        vm.formModel.videos = removeCaseVideo(vm.getVideos(), index);
        if (vm.formModel.videoFieldErrors) {
            delete vm.formModel.videoFieldErrors[video.youtubeVideoId];
        }
        vm.announceVideos(video, "case_videos_removed_announcement");
        const next = vm.formModel.videos[Math.min(index, vm.formModel.videos.length - 1)];
        vm.focusElement(next ? vm.getVideoControlId(next, "remove") : "caseIncludesVideos");
    };

    // Tells screen readers what happened to a video. Titles are appended, not
    // passed as translation parameters, which the app sanitizes as HTML.
    vm.announceVideos = function(video, key, values) {
        vm.videoAnnouncement = `${$translate.instant(key, values)} ${vm.getVideoTitle(video)}`;
    };

    vm.focusElement = function(elementId) {
        $timeout(() => {
            $window.document.getElementById(elementId)?.focus();
        });
    };

    vm.getVideoControlId = function(video, control) {
        return `caseVideo-${video.youtubeVideoId}-${control}`;
    };

    vm.getVideoTitle = function(video) {
        return video?.metadata?.title || video?.youtubeVideoId || "";
    };

    vm.formatVideoDuration = formatVideoDuration;

    vm.getVideoWarningKey = caseVideoWarningKey;

    vm.getVideoFieldErrorKey = function(video) {
        return vm.formModel?.videoFieldErrors?.[video.youtubeVideoId] || "";
    };

    vm.isPreviewDescriptionLong = function() {
        return isLongVideoDescription(vm.videoPreview?.metadata?.description);
    };

    vm.togglePreviewDescription = function() {
        vm.isPreviewDescriptionExpanded = !vm.isPreviewDescriptionExpanded;
    };

};

const caseFormEditorComponent = {
    bindings: {
        formModel:      "=",
        submitLabelKey: "@",
        isPdfRequired:  "<",
        showCurrentPdf: "<",
        licenses:       "<",
        languages:      "<",
        currentUserProfile: "<",
        onSave:         "&",
        onCancel:       "&",
        onPdfSelected:  "&",
    },
    controller: [
        "$scope", "$window", "$timeout", "$translate", "CasesCatalogService",
        CaseFormEditorController,
    ],
    templateUrl: "/assets/static/views/teacher/fragments/case-form-editor.template.html",
};

export default caseFormEditorComponent;
