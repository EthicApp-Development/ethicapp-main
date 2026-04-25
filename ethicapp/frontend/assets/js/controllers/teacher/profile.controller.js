export const ProfileController = function ($scope, $translate, toast, UserProfileService) {
    const vm = this;
    const TOAST_INFO_TIMEOUT_MS = 4 * 1000;
    const TOAST_ERROR_TIMEOUT_MS = 6 * 1000;

    vm.genderOptions = [
        { value: "F", label: "Femenino" },
        { value: "M", label: "Masculino" },
        { value: "O", label: "Otro" }
    ];

    vm.profile = {
        firstname: "",
        lastname: "",
        sex: "O",
        email: "",
        role: "",
        name: "",
        profile_image_path: null,
        profile_image_topbar_path: null
    };

    vm.selectedAvatarFile = null;
    vm.defaultProfileAvatar = "/assets/images/user-placeholder/profile-placeholder.svg";
    vm.defaultTopbarAvatar = "/assets/images/user-placeholder/avatar-placeholder-64.svg";
    vm.isRecaptchaEnabled = window.__ETHICAPP_RECAPTCHA_ENABLED__ === true;

    vm.isPasswordResetModalOpen = false;
    vm.profileRecaptchaWidgetId = null;
    vm.passwordResetRecaptchaWidgetId = null;
    vm.translate = (key) => $translate.instant(key);

    vm.getTopbarAvatar = () => vm.profile.profile_image_topbar_path || vm.defaultTopbarAvatar;
    vm.getProfileAvatar = () => vm.profile.profile_image_path || vm.defaultProfileAvatar;
    vm.showInfoToast = (message) => {
        toast.create({
            timeout: TOAST_INFO_TIMEOUT_MS,
            message,
            containerClass: "toast-container",
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
            containerClass: "toast-container",
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
        if (!vm.isRecaptchaEnabled) {
            return null;
        }

        if (!window.grecaptcha || widgetId === null || widgetId === undefined) {
            return null;
        }

        const token = window.grecaptcha.getResponse(widgetId);
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
                sex: data.sex || "O"
            };
        } catch (error) {
            console.error("Could not load profile:", error);
            vm.showErrorToast(vm.translate("profile_load_error"));
        }
    };

    vm.saveProfile = async () => {
        try {
            const recaptchaResponse = vm.getRecaptchaToken(vm.profileRecaptchaWidgetId);
            if (vm.isRecaptchaEnabled && !recaptchaResponse) {
                vm.showInfoToast(vm.translate("profile_recaptcha_save_warning"));
                return;
            }

            await UserProfileService.updateProfile({
                firstname: vm.profile.firstname,
                lastname: vm.profile.lastname,
                sex: vm.profile.sex,
                g_recaptcha_response: recaptchaResponse
            });

            await vm.loadProfile();
            if (vm.isRecaptchaEnabled && window.grecaptcha && vm.profileRecaptchaWidgetId !== null) {
                window.grecaptcha.reset(vm.profileRecaptchaWidgetId);
            }
            vm.showInfoToast(vm.translate("profile_update_success"));
        } catch (error) {
            console.error("Could not update profile:", error);
            vm.showErrorToast(vm.translate("profile_update_error"));
        }
    };

    vm.onAvatarSelected = (file) => {
        vm.selectedAvatarFile = file;
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
            await vm.loadProfile();
            if (vm.isRecaptchaEnabled && window.grecaptcha && vm.profileRecaptchaWidgetId !== null) {
                window.grecaptcha.reset(vm.profileRecaptchaWidgetId);
            }
            vm.showInfoToast(vm.translate("profile_avatar_update_success"));
        } catch (error) {
            console.error("Could not upload avatar:", error);
            const message = error?.data?.error === "avatar_size_limit_exceeded"
                ? vm.translate("profile_avatar_size_limit_error")
                : error?.data?.error === "invalid_avatar_type"
                    ? vm.translate("profile_avatar_invalid_type_error")
                    : vm.translate("profile_avatar_upload_error");
            vm.showErrorToast(message);
        }
    };

    vm.openPasswordResetModal = () => {
        vm.isPasswordResetModalOpen = true;
        setTimeout(vm.ensurePasswordResetRecaptcha, 200);
    };

    vm.closePasswordResetModal = () => {
        vm.isPasswordResetModalOpen = false;
        if (vm.isRecaptchaEnabled && window.grecaptcha && vm.passwordResetRecaptchaWidgetId !== null) {
            window.grecaptcha.reset(vm.passwordResetRecaptchaWidgetId);
        }
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
        } catch (error) {
            console.error("Could not trigger password reset:", error);
            vm.showErrorToast(vm.translate("profile_password_reset_error"));
        }
    };

    vm.loadProfile();
    setTimeout(vm.ensureProfileRecaptcha, 300);

    $scope.vm = vm;
};
