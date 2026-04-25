let UserProfileService = function ($http, Upload) {
    const service = {
        profileCache: null,

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
            service.profileCache = null;
            return response.data;
        },

        async uploadAvatar(file) {
            const response = await Upload.upload({
                url: "/users/profile/avatar",
                data: { avatar: file }
            });

            service.profileCache = null;
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
