let UserInformationService = function ($http) {
    const service = {
        // Local cache for user information
        userInfoCache: null,

        /**
         * Fetches user information from the backend and caches it.
         * If the data is already cached and reload is false, it returns the cached data.
         * @param {boolean} [reload=false] - If true, forces a refresh from the backend.
         * @returns {Promise<Object>} A promise that resolves with the user information.
         */
        getUserInformation: async function (reload = false) {
            // Use cached data unless reload is requested
            if (service.userInfoCache && !reload) {
                return Promise.resolve(service.userInfoCache); // Return cached data as a resolved promise
            }

            try {
                // Fetch data from the backend
                const response = await $http.get('/users/myinfo');
                service.userInfoCache = response.data.data; // Cache the fetched data
                return service.userInfoCache; // Return the cached data
            } catch (error) {
                console.error('Error fetching user information:', error);
                throw error; // Throw the error to propagate it to the caller
            }
        },

        /**
         * Clears the local cache, forcing the next call to fetch fresh data.
         */
        clearCache: function () {
            service.userInfoCache = null;
        },
    };
    return service;
};

export default UserInformationService;
