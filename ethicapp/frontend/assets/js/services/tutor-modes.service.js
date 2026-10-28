// The teacher UI's client for the modes of an activity's tutor sessions
// (#865): GET /activities/:id/tutor-modes. Only the activity's creator can
// read them: for any other activity the API answers 404.

function tutorModesUrl(sessionId) {
    return `/activities/${encodeURIComponent(sessionId)}/tutor-modes`;
}

export function TutorModesService($http) {
    // Every phase tab of the activity view asks at once; they share one request.
    const inflight = new Map();

    async function request(sessionId) {
        try {
            const response = await $http.get(tutorModesUrl(sessionId));
            const questions = response?.data?.result?.questions;
            if (response?.data?.status !== "ok" || !Array.isArray(questions)) {
                throw new Error("Unexpected tutor modes response format.");
            }
            return questions;
        } catch (error) {
            if (error?.status === 403 || error?.status === 404) {
                return [];
            }
            throw error;
        }
    }

    return {
        /**
         * The activity's tutor sessions, one per phase and question, with
         * `tutorMode`, `tutorModeReason`, `questionNumber` and `evaluations`
         * (see helpers/tutor-mode-records.js in the backend). [] when the
         * teacher cannot read the activity.
         */
        listTutorModes(sessionId) {
            const key = String(sessionId);
            if (!inflight.has(key)) {
                inflight.set(key, request(sessionId).finally(() => inflight.delete(key)));
            }
            return inflight.get(key);
        },
    };
}
