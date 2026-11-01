// The layout of the teacher dashboard's activity bar (#951, epic #892): one
// row while the activity's name fits next to the chips and the controls, or
// at least shows a readable part of itself; otherwise two rows, the name on
// top across the whole bar (two lines at most) and the chips and the controls
// below, wrapping instead of overflowing. The bar also publishes its height,
// so what sticks under it (the response table's header, the rail, the
// response detail panel) follows a taller bar.
//
// The decision is always measured on the single row. The bar drops its
// stacked class, reads how wide the row leaves the name and how wide the whole
// name is on one line, and sets the class again only if the name needs its
// own row; the browser lays out twice but paints once. Since the measurement
// never depends on the layout the bar had before, setting the class cannot
// change the next decision, so the bar cannot flip between its two layouts.
// The layout changes in an animation frame, not inside the ResizeObserver
// callback, so a bar that grows does not report a resize loop.

// The narrowest a cut name may get on the single row.
export const MIN_SINGLE_ROW_NAME_WIDTH = 280;

export const STACKED_CLASS = "activity-bar-stacked";
export const NAME_TRUNCATED_CLASS = "activity-bar-name-truncated";
export const BAR_HEIGHT_PROPERTY = "--activity-bar-height";

// Whether the name moves to a row of its own, from its widths on the single
// row: `shownWidth`, what the row leaves it, and `naturalWidth`, the whole
// name on one line. A name shown whole keeps the single row however narrow it
// is; a cut one needs at least `minWidth`. Widths come rounded to pixels, so
// one pixel short still counts as shown.
export function shouldStackActivityBar(
    shownWidth,
    naturalWidth,
    minWidth = MIN_SINGLE_ROW_NAME_WIDTH,
) {
    const shown = Number(shownWidth);
    const natural = Number(naturalWidth);
    if (!Number.isFinite(shown) || !Number.isFinite(natural) || natural <= 0) {
        return false;
    }

    return shown + 1 < Math.min(natural, minWidth);
}

// Whether an element cuts its text: an ellipsis on one line, or more lines
// than its line clamp shows.
export function isTextTruncated(element) {
    return Boolean(element)
        && (element.scrollWidth > element.clientWidth + 1
            || element.scrollHeight > element.clientHeight + 1);
}

// The bar's parts inside the `<activity-bar>` host, once its template is in.
function barParts(host) {
    const bar = host?.querySelector?.(".activity-bar");
    const name = bar?.querySelector(".activity-bar-name");
    if (!bar || !name) {
        return null;
    }
    return { bar, name, controls: bar.querySelector(".activity-bar-controls") };
}

// Lays the bar out for its current width and content: the stacked class, the
// cut name's class and tab stop (its tooltip shows the whole name on hover and
// keyboard focus), and the bar's height on the host's parent, where the
// content next to the bar reads it. Returns what it decided, or null before
// the template is in.
export function layOutActivityBar(host) {
    const parts = barParts(host);
    if (!parts) {
        return null;
    }

    const { bar, name } = parts;
    bar.classList.remove(STACKED_CLASS);
    const stacked = shouldStackActivityBar(name.clientWidth, name.scrollWidth);
    bar.classList.toggle(STACKED_CLASS, stacked);

    const truncated = isTextTruncated(name);
    bar.classList.toggle(NAME_TRUNCATED_CLASS, truncated);
    if (truncated) {
        name.setAttribute("tabindex", "0");
    } else {
        name.removeAttribute("tabindex");
    }

    const height = bar.getBoundingClientRect().height;
    host.parentElement?.style.setProperty(BAR_HEIGHT_PROPERTY, `${height}px`);
    return { stacked, truncated, height };
}

// Keeps the bar laid out while the window, the name or the controls change
// size. Without ResizeObserver it follows the window's resize events only;
// `refresh()` lays it out again on demand, as when the name arrives. One
// layout per animation frame at most. `stop()` stops watching and takes the
// published height back.
export function watchActivityBarLayout(host, win) {
    const requestFrame = typeof win?.requestAnimationFrame === "function"
        ? callback => win.requestAnimationFrame(callback)
        : callback => setTimeout(callback, 0);
    let pending = false;
    let stopped = false;

    function refresh() {
        if (pending || stopped) {
            return;
        }
        pending = true;
        requestFrame(() => {
            pending = false;
            if (!stopped) {
                layOutActivityBar(host);
            }
        });
    }

    let stopWatching = () => {};
    const parts = barParts(host);
    if (typeof win?.ResizeObserver === "function" && parts) {
        const observer = new win.ResizeObserver(refresh);
        [parts.bar, parts.name, parts.controls]
            .filter(Boolean)
            .forEach(element => observer.observe(element));
        stopWatching = () => observer.disconnect();
    } else if (typeof win?.addEventListener === "function") {
        win.addEventListener("resize", refresh);
        stopWatching = () => win.removeEventListener("resize", refresh);
    }

    refresh();

    return {
        refresh,
        stop() {
            stopped = true;
            stopWatching();
            host.parentElement?.style.removeProperty(BAR_HEIGHT_PROPERTY);
        },
    };
}
