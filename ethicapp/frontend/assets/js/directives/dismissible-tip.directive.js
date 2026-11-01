// `dismissible-tip="<class>"` on the element that owns a tooltip shown on
// hover and keyboard focus (#956; see helpers/dismissible-tip.js): while the
// pointer is on the element or the focus is inside it, Escape pressed
// anywhere in the document adds the class, which the tooltip's CSS hides it
// with, until both the pointer and the focus have left the element. The
// class is set on the element directly, with no digest.
//
// Every instance shares one document keydown listener, added with the first
// tooltip and removed with the last one's $destroy. It listens in the bubble
// phase and never stops the event or prevents its default, so the handlers
// that also act on Escape still do: the response detail panel's own keydown
// (which runs first, on its element) and $uibModal's document listener (which
// skips an event whose default was prevented). One Escape may then both close
// the panel and hide a hovered tooltip, which leaves nothing on screen that
// the teacher did not ask to keep.

import { createDismissibleTipState, createEscapeListeners } from "../helpers/dismissible-tip.js";

// Whether the pointer is on the element now, or null if the browser cannot
// tell: an element drawn under a still pointer (a table refreshed by the live
// dashboard) gets no mouseenter until the pointer moves.
function pointerIsOn(element) {
    try {
        return typeof element.matches === "function" ? element.matches(":hover") : null;
    } catch {
        return null;
    }
}

export function dismissibleTipDirective($document) {
    const escapeListeners = createEscapeListeners($document[0]);

    return {
        restrict: "A",
        link(scope, element, attrs) {
            const owner = element[0];
            const dismissedClass = attrs.dismissibleTip;
            const state = createDismissibleTipState();

            if (!dismissedClass) {
                return;
            }

            function render() {
                element.toggleClass(dismissedClass, state.dismissed);
            }

            function onPointerEnter() {
                state.pointerEnter();
            }

            function onPointerLeave() {
                state.pointerLeave();
                render();
            }

            function onFocusIn() {
                state.focusIn();
            }

            function onFocusOut(event) {
                const next = event?.relatedTarget;
                state.focusOut(Boolean(next) && owner.contains(next));
                render();
            }

            function onEscape() {
                const hovered = pointerIsOn(owner);
                if (hovered === true && !state.hovered) {
                    state.pointerEnter();
                } else if (hovered === false && state.hovered) {
                    state.pointerLeave();
                }
                state.escape();
                render();
            }

            element.on("mouseenter", onPointerEnter);
            element.on("mouseleave", onPointerLeave);
            element.on("focusin", onFocusIn);
            element.on("focusout", onFocusOut);
            const removeEscape = escapeListeners.add(onEscape);

            scope.$on("$destroy", function() {
                removeEscape();
                element.off("mouseenter", onPointerEnter);
                element.off("mouseleave", onPointerLeave);
                element.off("focusin", onFocusIn);
                element.off("focusout", onFocusOut);
            });
        },
    };
}
