// The last URL of the Cases page (#1018, epic #1008), so the case view's
// "← Cases" returns to the list with the tab and filters it had (`?tab=`,
// `?status=`, `?q=`). A listener on the route events feeds it: the page does
// not reload on a search change, so a change of tab or filter is a
// `$routeUpdate`, and arriving at the page is a `$routeChangeSuccess`.

export const CASES_LIST_PATH = "/cases";

/**
 * The URL of the Cases page within `url` (`$location.url()`), without its
 * hash, or null for any other page.
 */
export function casesListUrlOf(url) {
    const [pathAndSearch] = String(url || "").split("#");
    const [path] = pathAndSearch.split("?");
    return path === CASES_LIST_PATH ? pathAndSearch : null;
}

export function CasesListLocationService() {
    let lastUrl = CASES_LIST_PATH;

    return {
        /** Keeps `url` when it is a URL of the Cases page. */
        remember(url) {
            const listUrl = casesListUrlOf(url);
            if (listUrl !== null) {
                lastUrl = listUrl;
            }
        },

        /** The last URL of the Cases page, else `/cases`. */
        lastUrl() {
            return lastUrl;
        },

        /** A link to it, for an `href`. */
        lastHref() {
            return `#!${lastUrl}`;
        },
    };
}

/** Feeds the service from the route events; registered in a `run` block. */
export function trackCasesListLocation($rootScope, $location, CasesListLocationService) {
    const remember = () => CasesListLocationService.remember($location.url());
    $rootScope.$on("$routeChangeSuccess", remember);
    $rootScope.$on("$routeUpdate", remember);
}
