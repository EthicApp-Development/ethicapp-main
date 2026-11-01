// Tooltips of the teacher dashboard that Escape hides (#956): the question
// column headers (#895), the hold-to-confirm buttons (#893) and the
// activity's cut name in the bar (#951). Each tooltip shows while the
// pointer is on its owner element or, for the keyboard, while the focus is
// inside it. WCAG 2.1 SC 1.4.13 asks that it can be hidden without moving
// either, so Escape pressed anywhere in the document hides it while the
// owner is hovered or focused, and it stays hidden until both the pointer
// and the focus have left the owner.

export function isEscapeKey(event) {
    // "Esc" is what older browsers report.
    return event?.key === "Escape" || event?.key === "Esc";
}

// The state of one tooltip's owner: whether the pointer is on it, whether
// the focus is inside it and whether Escape hid its tooltip.
export function createDismissibleTipState() {
    let hovered = false;
    let focused = false;
    let dismissed = false;

    function settle() {
        if (!hovered && !focused) {
            dismissed = false;
        }
    }

    return {
        get hovered() {
            return hovered;
        },
        get focused() {
            return focused;
        },
        get dismissed() {
            return dismissed;
        },
        pointerEnter() {
            hovered = true;
        },
        pointerLeave() {
            hovered = false;
            settle();
        },
        focusIn() {
            focused = true;
        },
        // `stillInside`: the focus moved to another element of the owner.
        focusOut(stillInside = false) {
            focused = Boolean(stillInside);
            settle();
        },
        // Hides the tooltip if the owner is hovered or focused; true only
        // when this Escape hid it.
        escape() {
            if (dismissed || (!hovered && !focused)) {
                return false;
            }
            dismissed = true;
            return true;
        },
    };
}

// One keydown listener on `target` (the document) for every tooltip on the
// page: added with the first handler and removed with the last, so a table
// with many question headers adds no listener per header. Handlers run only
// for Escape. `add` returns the function that removes the handler.
export function createEscapeListeners(target) {
    const handlers = new Set();

    function onKeydown(event) {
        if (!isEscapeKey(event)) {
            return;
        }
        // A handler may remove itself or another one while they run.
        [...handlers].forEach(handler => handler(event));
    }

    return {
        get size() {
            return handlers.size;
        },
        add(handler) {
            if (handlers.size === 0) {
                target.addEventListener("keydown", onKeydown);
            }
            handlers.add(handler);
            return function remove() {
                if (handlers.delete(handler) && handlers.size === 0) {
                    target.removeEventListener("keydown", onKeydown);
                }
            };
        },
    };
}
