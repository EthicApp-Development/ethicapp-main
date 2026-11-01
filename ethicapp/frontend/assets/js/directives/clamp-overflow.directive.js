// Tells whether a height-clamped element hides part of its content, so a
// "show more" button appears only when there is more to show (#894, epic
// #892). `clamp-overflow="ctrl.instructionsOverflow"` assigns true or false to
// that expression whenever the element or its first child changes size, as
// rich text renders or the rail's width changes. Without ResizeObserver it
// measures once, after the first digest.

export function isClampedOverflowing(element) {
    return Boolean(element) && element.scrollHeight > element.clientHeight + 1;
}

export function clampOverflowDirective($parse) {
    return {
        restrict: "A",
        link(scope, element, attrs) {
            const assign = $parse(attrs.clampOverflow).assign;
            const target = element[0];
            let last = null;

            if (typeof assign !== "function") {
                return;
            }

            function measure() {
                const overflowing = isClampedOverflowing(target);
                if (overflowing !== last) {
                    last = overflowing;
                    scope.$applyAsync(() => assign(scope, overflowing));
                }
            }

            if (typeof ResizeObserver === "function") {
                const observer = new ResizeObserver(measure);
                observer.observe(target);
                if (target.firstElementChild) {
                    observer.observe(target.firstElementChild);
                }
                scope.$on("$destroy", () => observer.disconnect());
            }

            scope.$applyAsync(measure);
        },
    };
}
