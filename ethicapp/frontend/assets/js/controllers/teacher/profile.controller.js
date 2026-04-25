export const ProfileController = function ($scope, toast, UserProfileService) {
    const vm = $scope;

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
    vm.defaultProfileAvatar = "assets/images/user-placeholder/profile-placeholder.svg";
    vm.defaultTopbarAvatar = "assets/images/user-placeholder/avatar-placeholder-64.svg";
    vm.isRecaptchaEnabled = window.__ETHICAPP_RECAPTCHA_ENABLED__ === true;

    vm.isPasswordResetModalOpen = false;
    vm.profileRecaptchaWidgetId = null;
    vm.passwordResetRecaptchaWidgetId = null;

    vm.getTopbarAvatar = () => vm.profile.profile_image_topbar_path || vm.defaultTopbarAvatar;
    vm.getProfileAvatar = () => vm.profile.profile_image_path || vm.defaultProfileAvatar;

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

        const widgetId = window.grecaptcha.render(containerId, { sitekey: siteKey });
        currentWidgetIdSetter.set(widgetId);
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
            toast.error("No se pudo cargar el perfil");
        }
    };

    vm.saveProfile = async () => {
        try {
            const recaptchaResponse = vm.getRecaptchaToken(vm.profileRecaptchaWidgetId);
            if (vm.isRecaptchaEnabled && !recaptchaResponse) {
                toast.warning("Completa el reCAPTCHA para guardar cambios");
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
            toast.success("Perfil actualizado");
        } catch (error) {
            console.error("Could not update profile:", error);
            toast.error("No se pudo actualizar el perfil");
        }
    };

    vm.onAvatarSelected = (file) => {
        vm.selectedAvatarFile = file;
    };

    vm.uploadAvatar = async () => {
        if (!vm.selectedAvatarFile) {
            toast.warning("Selecciona una imagen JPG");
            return;
        }

        const recaptchaResponse = vm.getRecaptchaToken(vm.profileRecaptchaWidgetId);
        if (vm.isRecaptchaEnabled && !recaptchaResponse) {
            toast.warning("Completa el reCAPTCHA para actualizar la foto");
            return;
        }

        try {
            await UserProfileService.uploadAvatar(vm.selectedAvatarFile, recaptchaResponse);
            vm.selectedAvatarFile = null;
            await vm.loadProfile();
            if (vm.isRecaptchaEnabled && window.grecaptcha && vm.profileRecaptchaWidgetId !== null) {
                window.grecaptcha.reset(vm.profileRecaptchaWidgetId);
            }
            toast.success("Foto de perfil actualizada");
        } catch (error) {
            console.error("Could not upload avatar:", error);
            const message = error?.data?.error === "avatar_size_limit_exceeded"
                ? "La imagen supera el límite de 300 KB"
                : "No se pudo subir la imagen";
            toast.error(message);
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
                toast.warning("Completa el reCAPTCHA para continuar");
                return;
            }

            await UserProfileService.requestPasswordReset(vm.profile.email, recaptchaResponse);
            toast.success("Se envió el correo de recuperación");
            vm.closePasswordResetModal();
        } catch (error) {
            console.error("Could not trigger password reset:", error);
            toast.error("No fue posible iniciar la recuperación de contraseña");
        }
    };

    vm.loadProfile();
    setTimeout(vm.ensureProfileRecaptcha, 300);
};
