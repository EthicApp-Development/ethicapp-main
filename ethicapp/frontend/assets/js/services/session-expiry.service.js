// Handles API calls that find the teacher's session expired (#625): one
// translated notice, then a redirect to sign-in, however many calls fail.
// The NGINX edge answers expired API calls with 401 {"status":"expired"};
// an HTML page delivered to an API call means the same thing behind a proxy
// that still redirects. Sign-in keeps the role destination: nothing from the
// interrupted page is restored.

export const SIGN_IN_PATH = "/auth/login";
export const SESSION_EXPIRY_REDIRECT_DELAY_MS = 2500;

// Auth calls handle their own 401s; reacting to them would loop back into
// the sign-in flow.
const AUTH_PATH_PATTERN = /^\/(?:api\/)?auth(?:\/|$)/;

function requestPath(url) {
    try {
        return new URL(String(url ?? ""), "http://localhost/").pathname;
    } catch {
        return "";
    }
}

function readContentType(response) {
    const headers = response?.headers;
    const value = typeof headers === "function"
        ? headers("content-type")
        : headers?.["content-type"];
    return String(value ?? "");
}

export function isAuthEndpoint(url) {
    return AUTH_PATH_PATTERN.test(requestPath(url));
}

// AngularJS loads route, include and dialog templates through $http as well;
// those are HTML by design.
export function isTemplateRequest(url) {
    return requestPath(url).endsWith(".html");
}

/**
 * True when an $http response or rejection means the session expired.
 * @param {{ status?: number, headers?: Function|object, config?: { url?: string } }} response
 */
export function isExpiredSessionResponse(response) {
    const url = response?.config?.url;

    if (!response || isAuthEndpoint(url)) {
        return false;
    }

    if (response.status === 401) {
        return true;
    }

    return response.status >= 200 && response.status < 300 &&
        /\btext\/html\b/i.test(readContentType(response)) &&
        !isTemplateRequest(url);
}

/**
 * @param {object} options
 * @param {() => void} options.redirect
 * @param {(callback: () => void, delayMs: number) => unknown} options.schedule
 * @param {number} [options.delayMs]
 */
export function createSessionExpiryFlow({
    redirect,
    schedule,
    delayMs = SESSION_EXPIRY_REDIRECT_DELAY_MS
}) {
    let started = false;

    return {
        isStarted: () => started,
        /** Starts the notice and the redirect once; returns whether this call started them. */
        start() {
            if (started) {
                return false;
            }

            started = true;
            schedule(redirect, delayMs);
            return true;
        }
    };
}

export function SessionExpiryService($timeout, $window) {
    const flow = createSessionExpiryFlow({
        redirect: () => $window.location.assign(SIGN_IN_PATH),
        schedule: (callback, delayMs) => $timeout(callback, delayMs)
    });

    this.signInPath = SIGN_IN_PATH;
    this.isExpired = flow.isStarted;
    this.start = flow.start;
}

export function sessionExpiryInterceptor($q, SessionExpiryService) {
    return {
        response(response) {
            if (isExpiredSessionResponse(response)) {
                SessionExpiryService.start();
                return $q.reject(response);
            }

            return response;
        },
        responseError(rejection) {
            if (isExpiredSessionResponse(rejection)) {
                SessionExpiryService.start();
            }

            return $q.reject(rejection);
        }
    };
}

export const sessionExpiredNoticeComponent = {
    controller: ["SessionExpiryService", function(SessionExpiryService) {
        this.expiry = SessionExpiryService;
    }],
    template: `
        <div class="session-expired-notice" ng-if="$ctrl.expiry.isExpired()">
            <div class="alert alert-warning" role="alert">
                <i class="fa fa-spinner fa-spin" aria-hidden="true"></i>
                <span>{{ 'session_expired_notice' | translate }}</span>
                <a class="btn btn-default btn-sm" ng-href="{{ $ctrl.expiry.signInPath }}">
                    {{ 'session_expired_sign_in_now' | translate }}
                </a>
            </div>
        </div>
    `
};
