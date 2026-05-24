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
            const avatar = payload.avatar;
            const requestPayload = { ...payload };
            delete requestPayload.avatar;

            const response = avatar
                ? await Upload.upload({
                    url: "/users/profile",
                    data: {
                        ...requestPayload,
                        avatar
                    }
                })
                : await $http.post("/users/profile", requestPayload);

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
                email
            };

            if (recaptchaResponse) {
                payload.recaptcha_token = recaptchaResponse;
            }

            return $http.post("/api/auth/forgot", payload);
        }
    };

    return service;
};

export default UserProfileService;
