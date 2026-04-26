let UserProfileService = function ($http, $rootScope, Upload) {
    const service = {
        profileCache: null,
        notifyProfileChanged() {
            service.profileCache = null;
            $rootScope.$broadcast("user-profile:updated");
        },

        async getProfile(reload = false) {
            if (service.profileCache && !reload) {
                return service.profileCache;
            }

            const response = await $http.get("/users/profile");
            service.profileCache = response.data.data;
            return service.profileCache;
        },


        async getUserInformation(reload = false) {
            return service.getProfile(reload);
        },

        async updateProfile(payload) {
            const response = await $http.post("/users/profile", payload);
            service.notifyProfileChanged();
            return response.data;
        },

        async uploadAvatar(file, recaptchaResponse = null) {
            const data = { avatar: file };
            if (recaptchaResponse) {
                data.g_recaptcha_response = recaptchaResponse;
            }

            const response = await Upload.upload({
                url: "/users/profile/avatar",
                data
            });

            service.notifyProfileChanged();
            return response.data;
        },

        async requestPasswordReset(email, recaptchaResponse) {
            const payload = {
                email,
                lang: "es_CL"
            };

            if (recaptchaResponse) {
                payload.g_recaptcha_response = recaptchaResponse;
            }

            return $http.post("/forgot", payload);
        }
    };

    return service;
};

export default UserProfileService;
