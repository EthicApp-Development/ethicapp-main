import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    MIN_SINGLE_ROW_NAME_WIDTH,
    isTextTruncated,
    layOutActivityBar,
    shouldStackActivityBar,
    watchActivityBarLayout,
} from "../activity-bar-layout.js";
import { fakeActivityBar, fakeLayoutWindow } from "./fake-activity-bar.mjs";

// The 130-character name of the issue, about 1100 px on one line at 20 px.
const LONG_NAME_WIDTH = 1100;
const SHORT_NAME_WIDTH = 190;
// The chips and the controls at 390 px: wider than the bar on their own.
const PHONE = { width: 342, othersWidth: 422 };

describe("shouldStackActivityBar", () => {
    it("keeps one row while the whole name shows", () => {
        assert.equal(shouldStackActivityBar(190, 190), false);
        assert.equal(shouldStackActivityBar(189, 190), false, "one pixel short still counts as shown");
    });

    it("keeps one row while a cut name shows at least the minimum", () => {
        assert.equal(shouldStackActivityBar(MIN_SINGLE_ROW_NAME_WIDTH, LONG_NAME_WIDTH), false);
        assert.equal(shouldStackActivityBar(717, LONG_NAME_WIDTH), false);
    });

    it("stacks once a cut name shows less than the minimum, or nothing", () => {
        assert.equal(shouldStackActivityBar(MIN_SINGLE_ROW_NAME_WIDTH - 2, LONG_NAME_WIDTH), true);
        assert.equal(shouldStackActivityBar(0, LONG_NAME_WIDTH), true);
    });

    it("stacks a short name that cannot show whole", () => {
        assert.equal(shouldStackActivityBar(120, SHORT_NAME_WIDTH), true);
    });

    it("keeps one row without a name or a measurement", () => {
        assert.equal(shouldStackActivityBar(0, 0), false);
        assert.equal(shouldStackActivityBar(undefined, undefined), false);
        assert.equal(shouldStackActivityBar(Number.NaN, 300), false);
    });

    it("takes another minimum", () => {
        assert.equal(shouldStackActivityBar(150, 400, 120), false);
        assert.equal(shouldStackActivityBar(100, 400, 120), true);
    });
});

describe("isTextTruncated", () => {
    it("sees an ellipsis on one line and lines past the clamp", () => {
        assert.equal(isTextTruncated({ scrollWidth: 900, clientWidth: 300, scrollHeight: 26, clientHeight: 26 }), true);
        assert.equal(isTextTruncated({ scrollWidth: 300, clientWidth: 300, scrollHeight: 78, clientHeight: 52 }), true);
    });

    it("tolerates a pixel of rounding", () => {
        assert.equal(isTextTruncated({ scrollWidth: 301, clientWidth: 300, scrollHeight: 27, clientHeight: 26 }), false);
        assert.equal(isTextTruncated(null), false);
    });
});

describe("layOutActivityBar", () => {
    it("keeps a short name on one row at every width", () => {
        for (const width of [1656, 1256, 876, 400]) {
            const fake = fakeActivityBar({ width, nameWidth: SHORT_NAME_WIDTH, othersWidth: 180 });
            assert.deepEqual(layOutActivityBar(fake.host), { stacked: false, truncated: false, height: 56 });
            assert.equal(fake.nameTabIndex(), null, "a whole name takes no tab stop");
            assert.equal(fake.barHeight(), "56px");
        }
    });

    it("keeps a long name on one row, cut, while it shows at least the minimum", () => {
        const fake = fakeActivityBar({ width: 1256, nameWidth: LONG_NAME_WIDTH, othersWidth: 720 });
        assert.deepEqual(layOutActivityBar(fake.host), { stacked: false, truncated: true, height: 56 });
        assert.equal(fake.nameTabIndex(), "0", "a cut name takes a tab stop for its tooltip");
    });

    it("stacks a long name that would show less, and publishes the taller bar", () => {
        const fake = fakeActivityBar({ ...PHONE, nameWidth: LONG_NAME_WIDTH });
        const layout = layOutActivityBar(fake.host);

        assert.equal(layout.stacked, true);
        assert.equal(fake.isStacked(), true);
        assert.equal(layout.truncated, true, "more than two lines");
        assert.equal(fake.nameTabIndex(), "0");
        assert.equal(fake.barHeight(), `${16 + 52 + 6 + 34}px`);
    });

    it("drops the tab stop of a stacked name that shows whole on two lines", () => {
        const fake = fakeActivityBar({ ...PHONE, nameWidth: 500 });
        assert.deepEqual(layOutActivityBar(fake.host), { stacked: true, truncated: false, height: 108 });
        assert.equal(fake.nameTabIndex(), null);
    });

    it("decides the same again and again, stacked or not", () => {
        for (const width of [342, 876, 1256]) {
            const fake = fakeActivityBar({ width, nameWidth: LONG_NAME_WIDTH, othersWidth: 600 });
            const first = layOutActivityBar(fake.host);
            for (let i = 0; i < 5; i++) {
                assert.deepEqual(layOutActivityBar(fake.host), first, `width ${width}, round ${i}`);
            }
        }
    });

    it("waits for the template", () => {
        assert.equal(layOutActivityBar({ querySelector: () => null }), null);
        assert.equal(layOutActivityBar(undefined), null);
    });
});

describe("watchActivityBarLayout", () => {
    it("observes the bar, the name and the controls, and lays out in the next frame", () => {
        const win = fakeLayoutWindow();
        const fake = fakeActivityBar({ ...PHONE, nameWidth: LONG_NAME_WIDTH });
        watchActivityBarLayout(fake.host, win);

        assert.equal(win.observers.length, 1);
        assert.deepEqual(win.observers[0].observed, [fake.bar, fake.name, fake.controls]);
        assert.equal(fake.isStacked(), false, "nothing changes before the frame");

        win.frame();
        assert.equal(fake.isStacked(), true);
    });

    it("follows the bar's width both ways, and settles", () => {
        const win = fakeLayoutWindow();
        const fake = fakeActivityBar({ width: 1256, nameWidth: LONG_NAME_WIDTH, othersWidth: 720 });
        watchActivityBarLayout(fake.host, win);
        win.frame();
        assert.equal(fake.isStacked(), false);

        fake.state.width = 876;
        win.resize();
        win.frame();
        assert.equal(fake.isStacked(), true, "876 - 720 leaves the name under 280 px");
        const height = fake.barHeight();

        // The taller bar resizes the observed elements once more: the layout
        // stays as it is.
        win.resize();
        win.frame();
        assert.equal(fake.isStacked(), true);
        assert.equal(fake.barHeight(), height);

        fake.state.width = 1256;
        win.resize();
        win.frame();
        assert.equal(fake.isStacked(), false);
        assert.equal(fake.barHeight(), "56px");
    });

    it("lays out once per frame, however many resizes", () => {
        const win = fakeLayoutWindow();
        const fake = fakeActivityBar({ ...PHONE, nameWidth: LONG_NAME_WIDTH });
        watchActivityBarLayout(fake.host, win);
        win.resize();
        win.resize();
        assert.equal(win.frames.length, 1);
    });

    it("lays out again on demand", () => {
        const win = fakeLayoutWindow();
        const fake = fakeActivityBar({ ...PHONE, nameWidth: 0 });
        const layout = watchActivityBarLayout(fake.host, win);
        win.frame();
        assert.equal(fake.isStacked(), false, "no name yet");

        fake.state.nameWidth = LONG_NAME_WIDTH;
        layout.refresh();
        win.frame();
        assert.equal(fake.isStacked(), true);
    });

    it("follows the window's resizes without ResizeObserver", () => {
        const win = fakeLayoutWindow({ resizeObserver: false });
        const fake = fakeActivityBar({ width: 1256, nameWidth: LONG_NAME_WIDTH, othersWidth: 720 });
        const layout = watchActivityBarLayout(fake.host, win);
        win.frame();
        assert.equal(fake.isStacked(), false);

        fake.state.width = 342;
        win.resize();
        win.frame();
        assert.equal(fake.isStacked(), true);

        layout.stop();
        assert.equal(win.resizeListeners.size, 0);
    });

    it("stops watching and takes the published height back", () => {
        const win = fakeLayoutWindow();
        const fake = fakeActivityBar({ ...PHONE, nameWidth: LONG_NAME_WIDTH });
        const layout = watchActivityBarLayout(fake.host, win);
        win.frame();
        assert.ok(fake.barHeight());

        win.resize();
        layout.stop();
        win.frame();
        assert.equal(win.observers[0].disconnected, true);
        assert.equal(fake.barHeight(), undefined);
    });
});
