// Fakes for the dismissible tooltip tests (#956): a document that takes
// keydown listeners, and a tooltip's owner element wrapped as jqLite wraps
// it, which the test hovers, focuses and leaves as a browser would.

function fakeKeyEvent(key) {
    return {
        key,
        defaultPrevented:   false,
        propagationStopped: false,
        preventDefault() {
            this.defaultPrevented = true;
        },
        stopPropagation() {
            this.propagationStopped = true;
        },
    };
}

export function fakeKeyTarget() {
    const listeners = new Set();
    return {
        listeners,
        addEventListener(type, listener) {
            if (type === "keydown") {
                listeners.add(listener);
            }
        },
        removeEventListener(type, listener) {
            if (type === "keydown") {
                listeners.delete(listener);
            }
        },
        keydown(key) {
            const event = fakeKeyEvent(key);
            [...listeners].forEach(listener => listener(event));
            return event;
        },
    };
}

// `hoverMatches`: whether the owner answers `:hover` (false: the browser
// cannot tell, so only the mouse events count).
export function fakeTipOwner({ hoverMatches = true } = {}) {
    const classes = new Set();
    const handlers = new Map();
    const inside = { id: "inside" };
    const owner = {
        hovered:  false,
        contains: node => node === owner || node === inside,
    };
    if (hoverMatches) {
        owner.matches = selector => selector === ":hover" && owner.hovered;
    }

    const element = [owner];
    element.on = (type, handler) => handlers.set(type, handler);
    element.off = (type, handler) => {
        if (handlers.get(type) === handler) {
            handlers.delete(type);
        }
    };
    element.toggleClass = (name, on) => (on ? classes.add(name) : classes.delete(name));

    const fire = (type, event = {}) => handlers.get(type)?.(event);

    return {
        element,
        owner,
        inside,
        handlers,
        hasClass: name => classes.has(name),
        // The pointer moves onto the owner, or is drawn under it with no event.
        enter({ silently = false } = {}) {
            owner.hovered = true;
            if (!silently) {
                fire("mouseenter");
            }
        },
        leave() {
            owner.hovered = false;
            fire("mouseleave");
        },
        focus() {
            fire("focusin");
        },
        // `to`: where the focus goes; null for outside the page.
        blur(to = null) {
            fire("focusout", { relatedTarget: to });
        },
    };
}
