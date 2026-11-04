// When an activity was launched or ended (#1050, epic #1046): relative while
// recent, a short date after that, and the full date for the hover title, in
// the time zone and language given.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    DATE_TODAY_KEY,
    DATE_YESTERDAY_KEY,
    createActivityDateFormatter,
    uiLanguageOf,
} from "../activity-dates.js";

describe("uiLanguageOf (#1055)", () => {
    it("gives the language in use, else the one loading, else English", () => {
        const loading = proposed => ({ use: () => undefined, proposedLanguage: () => proposed });
        assert.equal(uiLanguageOf({ use: () => "es_CL", proposedLanguage: () => "en_US" }),
            "es_CL");
        assert.equal(uiLanguageOf(loading("es_CL")), "es_CL");
        assert.equal(uiLanguageOf(loading(undefined)), "en_US");
        assert.equal(uiLanguageOf({ use: () => undefined }), "en_US");
        assert.equal(uiLanguageOf(null), "en_US");
    });
});

// 2026-11-03 15:00 in Santiago (UTC-3 in November).
const NOW = new Date("2026-11-03T18:00:00Z");
const SANTIAGO = "America/Santiago";

function formatter(uiLanguage, options = {}) {
    return createActivityDateFormatter({ uiLanguage, now: NOW, timeZone: SANTIAGO, ...options });
}

describe("activity dates, labels", () => {
    it("says today with the time on a 24-hour clock in Spanish", () => {
        assert.deepEqual(formatter("es_CL").label("2026-11-03T21:01:00Z"),
            { key: DATE_TODAY_KEY, params: { time: "18:01" } });
    });

    it("says yesterday with the time", () => {
        assert.deepEqual(formatter("es_CL").label("2026-11-02T12:05:00Z"),
            { key: DATE_YESTERDAY_KEY, params: { time: "09:05" } });
    });

    it("keeps the locale's clock in English", () => {
        const label = formatter("en_US").label("2026-11-03T21:01:00Z");
        assert.equal(label.key, DATE_TODAY_KEY);
        assert.match(label.params.time, /^6:01\sPM$/);
    });

    it("counts days in the given time zone, not in UTC", () => {
        // 02:30 UTC on Nov 3 is still Nov 2 in Santiago.
        assert.equal(formatter("es_CL").label("2026-11-03T02:30:00Z").key, DATE_YESTERDAY_KEY);
        // The same moment is "today" in UTC.
        assert.equal(formatter("es_CL", { timeZone: "UTC" }).label("2026-11-03T02:30:00Z").key,
            DATE_TODAY_KEY);
    });

    it("gives a short date from two days back, localized", () => {
        assert.match(formatter("es_CL").label("2026-10-12T15:00:00Z").text, /^12 oct\.?$/);
        assert.equal(formatter("en_US").label("2026-10-12T15:00:00Z").text, "Oct 12");
    });

    it("adds the time to older dates when asked, as the Terminada column", () => {
        assert.match(formatter("es_CL").label("2026-11-01T14:30:00Z", { withTime: true }).text,
            /^1 nov\.?,? 11:30$/);
        assert.match(formatter("en_US").label("2026-11-01T14:30:00Z", { withTime: true }).text,
            /^Nov 1, 11:30\sAM$/);
    });

    it("adds the year to a date of another year", () => {
        assert.match(formatter("es_CL").label("2025-10-12T15:00:00Z").text, /2025/);
        assert.match(formatter("en_US").label("2025-12-30T15:00:00Z", { withTime: true }).text,
            /Dec 30, 2025/);
    });

    it("has no label for a missing or invalid date", () => {
        const dates = formatter("es_CL");
        assert.equal(dates.label(null), null);
        assert.equal(dates.label(undefined), null);
        assert.equal(dates.label("not a date"), null);
        assert.equal(dates.label({}), null);
    });

    it("accepts Date objects and timestamps", () => {
        const dates = formatter("es_CL");
        assert.equal(dates.label(new Date("2026-11-03T21:01:00Z")).key, DATE_TODAY_KEY);
        assert.equal(dates.label(Date.parse("2026-11-03T21:01:00Z")).key, DATE_TODAY_KEY);
    });

    it("falls back to English for an unknown language", () => {
        assert.equal(formatter("xx_INVALID_LANGUAGE_TAG!").label("2026-10-12T15:00:00Z").text,
            "Oct 12");
    });
});

describe("activity dates, full date", () => {
    it("gives the full date and time for the hover title", () => {
        assert.equal(formatter("es_CL").full("2026-11-02T21:01:00Z"),
            "lunes, 2 de noviembre de 2026, 18:01");
        assert.match(formatter("en_US").full("2026-11-02T21:01:00Z"),
            /^Monday, November 2, 2026(,| at) 6:01\sPM$/);
    });

    it("is empty for an invalid date", () => {
        assert.equal(formatter("es_CL").full(null), "");
        assert.equal(formatter("es_CL").full("nope"), "");
    });
});
