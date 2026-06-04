export const ProfileController = function ($scope, $translate, toast, UserProfileService, LanguageCatalogService) {
    const vm = this;
    const TOAST_INFO_TIMEOUT_MS = 4 * 1000;
    const TOAST_ERROR_TIMEOUT_MS = 6 * 1000;

    vm.genderOptions = [];
    vm.languageOptions = [];

    vm.profile = {
        firstname: "",
        lastname: "",
        sex: "O",
        email: "",
        role: "",
        name: "",
        preferred_locale: "en_US",
        profile_image_path: null,
        profile_image_topbar_path: null
    };

    vm.selectedAvatarFile = null;
    vm.selectedAvatarPreviewUrl = null;
    vm.defaultProfileAvatar = "/assets/images/user-placeholder/incognito-user.svg";
    vm.defaultTopbarAvatar = "/assets/images/user-placeholder/avatar-placeholder-64.svg";
    vm.avatarCacheToken = Date.now();
    vm.isRecaptchaEnabled = window.__ETHICAPP_RECAPTCHA_ENABLED__ === true;

    vm.isPasswordResetModalOpen = false;
    vm.profileRecaptchaWidgetId = null;
    vm.passwordResetRecaptchaWidgetId = null;
    vm.translate = (key) => $translate.instant(key);
    vm.applyChanges = () => {
        if (!$scope.$$destroyed) {
            $scope.$applyAsync();
        }
    };
    vm.refreshGenderOptions = () => {
        vm.genderOptions = [
            { value: "F", label: vm.translate("female") },
            { value: "M", label: vm.translate("male") },
            { value: "O", label: vm.translate("other") }
        ];
    };
    vm.refreshLanguageOptions = (languages = []) => {
        vm.languageOptions = languages.map((language) => ({
            value: language.code,
            label: language.native_name || language.name || language.code
        }));
    };

    vm.withCacheToken = (url) => {
        if (!url) {
            return "";
        }

        const separator = url.includes("?") ? "&" : "?";
        return `${url}${separator}v=${vm.avatarCacheToken}`;
    };
    vm.getTopbarAvatar = () => vm.withCacheToken(vm.profile.profile_image_topbar_path || vm.defaultTopbarAvatar);
    vm.getProfileAvatar = () => {
        if (vm.selectedAvatarPreviewUrl) {
            return vm.selectedAvatarPreviewUrl;
        }

        return vm.withCacheToken(vm.profile.profile_image_path || vm.defaultProfileAvatar);
    };
    vm.showInfoToast = (message) => {
        toast.create({
            timeout: TOAST_INFO_TIMEOUT_MS,
            message,
            containerClass: "profile-toast-container",
            dismissible: false,
            defaultToastClass: "toast",
            insertFromTop: true
        });
    };
    vm.showErrorToast = (message) => {
        toast.create({
            timeout: TOAST_ERROR_TIMEOUT_MS,
            message,
            className: "alert-danger",
            containerClass: "profile-toast-container",
            dismissible: false,
            defaultToastClass: "toast",
            insertFromTop: true
        });
    };

    vm.getDisplayName = () => {
        const first = vm.profile.firstname || "";
        const last = vm.profile.lastname || "";
        const fullName = `${first} ${last}`.trim();
        return fullName || vm.profile.name || "";
    };

    vm.getRecaptchaToken = (widgetId) => {
        if (!vm.isRecaptchaEnabled || !window.grecaptcha) {
            return null;
        }

        const token = (widgetId === null || widgetId === undefined)
            ? window.grecaptcha.getResponse()
            : window.grecaptcha.getResponse(widgetId);

        return token || null;
    };

    vm.ensureRecaptchaWidget = (containerId, currentWidgetIdSetter) => {
        if (!vm.isRecaptchaEnabled || !window.grecaptcha) {
            return;
        }

        const siteKey = window.__ETHICAPP_RECAPTCHA_SITE_KEY__;
        if (!siteKey) {
            return;
        }

        const container = document.getElementById(containerId);
        if (!container) {
            return;
        }

        if (currentWidgetIdSetter.get() !== null) {
            return;
        }

        if (container.dataset.recaptchaRendered === "true" || container.childElementCount > 0) {
            container.dataset.recaptchaRendered = "true";
            return;
        }

        const widgetId = window.grecaptcha.render(containerId, { sitekey: siteKey });
        currentWidgetIdSetter.set(widgetId);
        container.dataset.recaptchaRendered = "true";
    };

    vm.ensureProfileRecaptcha = () => {
        vm.ensureRecaptchaWidget("profile-recaptcha-container", {
            get: () => vm.profileRecaptchaWidgetId,
            set: (value) => {
                vm.profileRecaptchaWidgetId = value;
            }
        });
    };

    vm.ensurePasswordResetRecaptcha = () => {
        vm.ensureRecaptchaWidget("password-reset-recaptcha-container", {
            get: () => vm.passwordResetRecaptchaWidgetId,
            set: (value) => {
                vm.passwordResetRecaptchaWidgetId = value;
            }
        });
    };

    vm.loadProfile = async () => {
        try {
            const data = await UserProfileService.getProfile(true);
            vm.profile = {
                ...vm.profile,
                ...data,
                sex: data.sex || "O",
                preferred_locale: data.preferred_locale || vm.profile.preferred_locale
            };
            await $translate.use(LanguageCatalogService.getUiLanguageCodeForLocale(vm.profile.preferred_locale));
            vm.avatarCacheToken = Date.now();
            vm.applyChanges();
        } catch (error) {
            console.error("Could not load profile:", error);
            vm.showErrorToast(vm.translate("profile_load_error"));
            vm.applyChanges();
        }
    };

    vm.saveProfile = async () => {
        try {
            const recaptchaResponse = vm.getRecaptchaToken(vm.profileRecaptchaWidgetId);
            if (vm.isRecaptchaEnabled && !recaptchaResponse) {
                vm.showInfoToast(vm.translate("profile_recaptcha_save_warning"));
                return;
            }

            const result = await UserProfileService.updateProfile({
                firstname: vm.profile.firstname,
                lastname: vm.profile.lastname,
                sex: vm.profile.sex,
                preferred_locale: vm.profile.preferred_locale,
                avatar: vm.selectedAvatarFile,
                g_recaptcha_response: recaptchaResponse
            });

            if (result?.data) {
                vm.profile = {
                    ...vm.profile,
                    ...result.data
                };
                vm.avatarCacheToken = Date.now();
            }
            await $translate.use(LanguageCatalogService.getUiLanguageCodeForLocale(vm.profile.preferred_locale));

            vm.clearSelectedAvatar();

            if (vm.isRecaptchaEnabled && window.grecaptcha && vm.profileRecaptchaWidgetId !== null) {
                window.grecaptcha.reset(vm.profileRecaptchaWidgetId);
            }
            vm.showInfoToast(vm.translate("profile_update_success"));
            vm.applyChanges();
        } catch (error) {
            console.error("Could not update profile:", error);
            vm.showErrorToast(vm.getProfileSaveErrorMessage(error));
            vm.applyChanges();
        }
    };

    vm.loadLanguageOptions = async () => {
        try {
            const languages = await LanguageCatalogService.getLanguages();
            vm.refreshLanguageOptions(languages);
            if (!vm.languageOptions.some((option) => option.value === vm.profile.preferred_locale)) {
                vm.profile.preferred_locale = LanguageCatalogService.getDefaultLanguageCode(languages, vm.profile.preferred_locale);
            }
            vm.applyChanges();
        } catch (error) {
            console.error("Could not load languages:", error);
            vm.showErrorToast(vm.translate("profile_languages_load_error"));
            vm.applyChanges();
        }
    };

    vm.onAvatarSelected = (file) => {
        if (vm.selectedAvatarPreviewUrl) {
            URL.revokeObjectURL(vm.selectedAvatarPreviewUrl);
            vm.selectedAvatarPreviewUrl = null;
        }

        vm.selectedAvatarFile = file;
        if (file) {
            vm.selectedAvatarPreviewUrl = URL.createObjectURL(file);
        }
        vm.applyChanges();
    };

    vm.clearSelectedAvatar = () => {
        if (vm.selectedAvatarPreviewUrl) {
            URL.revokeObjectURL(vm.selectedAvatarPreviewUrl);
        }
        vm.selectedAvatarFile = null;
        vm.selectedAvatarPreviewUrl = null;
    };

    vm.getProfileSaveErrorMessage = (error) => {
        if (error?.data?.error === "avatar_size_limit_exceeded") {
            return vm.translate("profile_avatar_size_limit_error");
        }

        if (error?.data?.error === "invalid_avatar_type") {
            return vm.translate("profile_avatar_invalid_type_error");
        }

        if (error?.data?.error === "avatar_upload_failed") {
            return vm.translate("profile_avatar_upload_error");
        }

        return vm.translate("profile_update_error");
    };

    vm.uploadAvatar = async () => {
        if (!vm.selectedAvatarFile) {
            vm.showInfoToast(vm.translate("profile_avatar_select_jpg_or_png_warning"));
            return;
        }

        const recaptchaResponse = vm.getRecaptchaToken(vm.profileRecaptchaWidgetId);
        if (vm.isRecaptchaEnabled && !recaptchaResponse) {
            vm.showInfoToast(vm.translate("profile_avatar_recaptcha_warning"));
            return;
        }

        try {
            await UserProfileService.uploadAvatar(vm.selectedAvatarFile, recaptchaResponse);
            vm.selectedAvatarFile = null;
            if (vm.isRecaptchaEnabled && window.grecaptcha && vm.profileRecaptchaWidgetId !== null) {
                window.grecaptcha.reset(vm.profileRecaptchaWidgetId);
            }
            vm.showInfoToast(vm.translate("profile_avatar_update_success"));
            vm.applyChanges();
        } catch (error) {
            console.error("Could not upload avatar:", error);
            const message = error?.data?.error === "avatar_size_limit_exceeded"
                ? vm.translate("profile_avatar_size_limit_error")
                : error?.data?.error === "invalid_avatar_type"
                    ? vm.translate("profile_avatar_invalid_type_error")
                    : vm.translate("profile_avatar_upload_error");
            vm.showErrorToast(message);
            vm.applyChanges();
        }
    };

    vm.openPasswordResetModal = () => {
        vm.isPasswordResetModalOpen = true;
        setTimeout(vm.ensurePasswordResetRecaptcha, 200);
        vm.applyChanges();
    };

    vm.closePasswordResetModal = () => {
        vm.isPasswordResetModalOpen = false;
        if (vm.isRecaptchaEnabled && window.grecaptcha && vm.passwordResetRecaptchaWidgetId !== null) {
            window.grecaptcha.reset(vm.passwordResetRecaptchaWidgetId);
        }
        vm.applyChanges();
    };

    vm.confirmPasswordReset = async () => {
        try {
            const recaptchaResponse = vm.getRecaptchaToken(vm.passwordResetRecaptchaWidgetId);
            if (vm.isRecaptchaEnabled && !recaptchaResponse) {
                vm.showInfoToast(vm.translate("profile_reset_recaptcha_warning"));
                return;
            }

            await UserProfileService.requestPasswordReset(vm.profile.email, recaptchaResponse);
            vm.showInfoToast(vm.translate("profile_password_reset_success"));
            vm.closePasswordResetModal();
            vm.applyChanges();
        } catch (error) {
            console.error("Could not trigger password reset:", error);
            vm.showErrorToast(vm.translate("profile_password_reset_error"));
            vm.applyChanges();
        }
    };

    vm.refreshGenderOptions();
    vm.loadLanguageOptions();
    vm.loadProfile();
    setTimeout(vm.ensureProfileRecaptcha, 300);
    const languageChangeListener = $scope.$on("$translateChangeSuccess", () => {
        vm.refreshGenderOptions();
        vm.applyChanges();
    });
    const profileUpdateListener = $scope.$on("user-profile:updated", () => {
        vm.loadProfile();
    });

    $scope.vm = vm;
    $scope.$on("$destroy", () => {
        languageChangeListener();
        profileUpdateListener();
        vm.clearSelectedAvatar();
    });
};
