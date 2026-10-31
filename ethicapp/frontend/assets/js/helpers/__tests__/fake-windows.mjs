// Fake browser windows for the dashboard layout tests (#895): the test sets
// the width and fires what a browser would when the window is resized.

// A window with media queries; every query matches from 1200 px wide, as the
// dashboard's two-column query does.
export function fakeMediaWindow(innerWidth) {
    const listeners = new Set();
    const query = {
        get matches() {
            return win.innerWidth >= 1200;
        },
        addEventListener(type, listener) {
            if (type === "change") {
                listeners.add(listener);
            }
        },
        removeEventListener(type, listener) {
            listeners.delete(listener);
        },
    };
    const win = {
        innerWidth,
        queries: [],
        listeners,
        matchMedia(media) {
            win.queries.push(media);
            return query;
        },
        resize(width) {
            win.innerWidth = width;
            listeners.forEach(listener => listener({ matches: query.matches }));
        },
    };
    return win;
}

// A window without matchMedia, only resize events.
export function fakeResizeWindow(innerWidth) {
    const listeners = new Set();
    const win = {
        innerWidth,
        listeners,
        addEventListener(type, listener) {
            if (type === "resize") {
                listeners.add(listener);
            }
        },
        removeEventListener(type, listener) {
            listeners.delete(listener);
        },
        resize(width) {
            win.innerWidth = width;
            listeners.forEach(listener => listener());
        },
    };
    return win;
}
