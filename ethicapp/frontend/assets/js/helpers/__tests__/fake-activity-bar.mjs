// A fake activity bar and window for the bar's layout tests (#951). The bar
// lays itself out as a browser would: on one row the title gets what the
// chips and the controls leave, the description cut before the name, each
// with an ellipsis; stacked, it gets the whole bar and wraps to two lines at
// most. The window runs animation frames and resize observers when the test
// says so.

const LINE_HEIGHT = 26;
const ONE_ROW_HEIGHT = 56;
const META_ROW_HEIGHT = 34;

function fakeClassList() {
    const classes = new Set();
    return {
        contains: name => classes.has(name),
        remove:   name => classes.delete(name),
        toggle(name, force) {
            const add = force === undefined ? !classes.has(name) : Boolean(force);
            if (add) {
                classes.add(name);
            } else {
                classes.delete(name);
            }
            return add;
        },
    };
}

function fakeStyle() {
    const properties = new Map();
    return {
        properties,
        setProperty:    (name, value) => properties.set(name, value),
        removeProperty: name => properties.delete(name),
    };
}

// `width`: the bar's content width; `nameWidth`: the whole name on one line;
// `descriptionWidth`: the description with its separator on one line, 0
// without a description (#973); `othersWidth`: the chips, the controls and
// the gaps between them and the title, on one row. On one row the heading
// (`name`) gets what the row leaves the title, and the description gives it
// up before the name; stacked, both wrap together in the heading.
export function fakeActivityBar({ width, nameWidth, descriptionWidth = 0, othersWidth }) {
    const state = { width, nameWidth, descriptionWidth, othersWidth };
    const attributes = new Map();
    const stacked = () => bar.classList.contains("activity-bar-stacked");
    const titleWidth = () => state.nameWidth + state.descriptionWidth;
    const nameLines = () => Math.max(1, Math.ceil(titleWidth() / state.width));
    const rowWidth = () => Math.min(titleWidth(), Math.max(0, state.width - state.othersWidth));

    const name = {
        get clientWidth() {
            return stacked() ? state.width : rowWidth();
        },
        get scrollWidth() {
            return stacked() ? state.width : rowWidth();
        },
        get clientHeight() {
            return stacked() ? Math.min(nameLines(), 2) * LINE_HEIGHT : LINE_HEIGHT;
        },
        get scrollHeight() {
            return stacked() ? nameLines() * LINE_HEIGHT : LINE_HEIGHT;
        },
        setAttribute:    (key, value) => attributes.set(key, String(value)),
        removeAttribute: key => attributes.delete(key),
        getAttribute:    key => (attributes.has(key) ? attributes.get(key) : null),
    };
    // Inline on a stacked bar, where they measure nothing.
    const nameText = {
        get clientWidth() {
            return stacked() ? 0 : Math.min(state.nameWidth, rowWidth());
        },
        get scrollWidth() {
            return stacked() ? 0 : state.nameWidth;
        },
        clientHeight: 0,
        scrollHeight: 0,
    };
    const description = {
        get clientWidth() {
            return stacked() ? 0 : Math.max(0, Math.min(state.descriptionWidth, rowWidth() - state.nameWidth));
        },
        get scrollWidth() {
            return stacked() ? 0 : state.descriptionWidth;
        },
        clientHeight: 0,
        scrollHeight: 0,
    };
    const controls = {};
    const bar = {
        classList: fakeClassList(),
        querySelector(selector) {
            return {
                ".activity-bar-name":        name,
                ".activity-bar-name-text":   nameText,
                ".activity-bar-description": state.descriptionWidth > 0 ? description : null,
                ".activity-bar-controls":    controls,
            }[selector] || null;
        },
        getBoundingClientRect() {
            const height = stacked()
                ? 16 + Math.min(nameLines(), 2) * LINE_HEIGHT + 6 + META_ROW_HEIGHT
                : ONE_ROW_HEIGHT;
            return { width: state.width + 24, height };
        },
    };
    const parent = { style: fakeStyle() };
    const host = {
        parentElement: parent,
        querySelector: selector => (selector === ".activity-bar" ? bar : null),
    };

    return {
        host,
        bar,
        name,
        nameText,
        description,
        controls,
        state,
        isStacked:    stacked,
        isTruncated:  () => bar.classList.contains("activity-bar-name-truncated"),
        nameTabIndex: () => name.getAttribute("tabindex"),
        barHeight:    () => parent.style.properties.get("--activity-bar-height"),
    };
}

// A window with animation frames and, unless `resizeObserver` is false,
// ResizeObserver. `frame()` runs the frames requested so far; `resize()`
// fires every observer, or the resize event without them.
export function fakeLayoutWindow({ resizeObserver = true } = {}) {
    const frames = [];
    const observers = [];
    const resizeListeners = new Set();

    class FakeResizeObserver {
        constructor(callback) {
            this.callback = callback;
            this.observed = [];
            this.disconnected = false;
            observers.push(this);
        }

        observe(element) {
            this.observed.push(element);
        }

        disconnect() {
            this.disconnected = true;
        }
    }

    const win = {
        frames,
        observers,
        resizeListeners,
        requestAnimationFrame(callback) {
            frames.push(callback);
            return frames.length;
        },
        addEventListener(type, listener) {
            if (type === "resize") {
                resizeListeners.add(listener);
            }
        },
        removeEventListener(type, listener) {
            if (type === "resize") {
                resizeListeners.delete(listener);
            }
        },
        frame() {
            frames.splice(0).forEach(callback => callback());
        },
        resize() {
            observers.filter(observer => !observer.disconnected).forEach(observer => observer.callback([]));
            resizeListeners.forEach(listener => listener());
        },
    };
    if (resizeObserver) {
        win.ResizeObserver = FakeResizeObserver;
    }
    return win;
}
