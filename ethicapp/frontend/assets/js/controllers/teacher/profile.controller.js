import { getRecaptchaResponse } from "../common/recaptcha-api.js";

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

    vm.passwordResetEmail = "";
    vm.selectedAvatarFile = null;
    vm.defaultProfileAvatar = "assets/images/user-placeholder/profile-placeholder.svg";
    vm.defaultTopbarAvatar = "assets/images/user-placeholder/avatar-placeholder-64.svg";

    vm.isRecaptchaEnabled = window.__ETHICAPP_RECAPTCHA_ENABLED__ === true;

    vm.getTopbarAvatar = () => vm.profile.profile_image_topbar_path || vm.defaultTopbarAvatar;

    vm.recaptchaWidgetId = null;

    vm.ensureRecaptcha = () => {
        if (!vm.isRecaptchaEnabled || !window.grecaptcha || vm.recaptchaWidgetId !== null) {
            return;
        }

        const siteKey = window.__ETHICAPP_RECAPTCHA_SITE_KEY__;
        if (!siteKey) {
            return;
        }

        const container = document.getElementById("recaptcha-container");
        if (!container) {
            return;
        }

        vm.recaptchaWidgetId = window.grecaptcha.render("recaptcha-container", {
            sitekey: siteKey
        });
    };
    vm.getProfileAvatar = () => vm.profile.profile_image_path || vm.defaultProfileAvatar;

    vm.getDisplayName = () => {
        const first = vm.profile.firstname || "";
        const last = vm.profile.lastname || "";
        const fullName = `${first} ${last}`.trim();
        return fullName || vm.profile.name || "";
    };

    vm.loadProfile = async () => {
        try {
            const data = await UserProfileService.getProfile(true);
            vm.profile = {
                ...vm.profile,
                ...data,
                sex: data.sex || "O"
            };
            vm.passwordResetEmail = vm.profile.email || "";
        } catch (error) {
            console.error("Could not load profile:", error);
            toast.error("No se pudo cargar el perfil");
        }
    };

    vm.saveProfile = async () => {
        try {
            await UserProfileService.updateProfile({
                firstname: vm.profile.firstname,
                lastname: vm.profile.lastname,
                sex: vm.profile.sex
            });

            await vm.loadProfile();
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

        try {
            await UserProfileService.uploadAvatar(vm.selectedAvatarFile);
            vm.selectedAvatarFile = null;
            await vm.loadProfile();
            toast.success("Foto de perfil actualizada");
        } catch (error) {
            console.error("Could not upload avatar:", error);
            const message = error?.data?.error === "avatar_size_limit_exceeded"
                ? "La imagen supera el límite de 300 KB"
                : "No se pudo subir la imagen";
            toast.error(message);
        }
    };

    vm.triggerPasswordReset = async () => {
        try {
            const recaptchaResponse = vm.isRecaptchaEnabled ? getRecaptchaResponse() : null;
            if (vm.isRecaptchaEnabled && !recaptchaResponse) {
                toast.warning("Completa el reCAPTCHA");
                return;
            }

            await UserProfileService.requestPasswordReset(vm.passwordResetEmail, recaptchaResponse);
            toast.success("Se envió el correo de recuperación");
        } catch (error) {
            console.error("Could not trigger password reset:", error);
            toast.error("No fue posible iniciar la recuperación de contraseña");
        }
    };

    vm.loadProfile();
    setTimeout(vm.ensureRecaptcha, 300);
};
