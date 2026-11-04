// When an activity was launched or ended, as the teacher's pages say it
// (#1050, epic #1046): in the browser's time zone, relative while recent
// ("hoy, 18:01", "ayer, 09:05") and as a short date after that ("12 oct"),
// with the full date and time for the hover title. The activities table and
// the activity card (`activity-description`, #1055) use it.
//
// A formatter is made once per list and language: building the Intl
// formatters is the costly part. "Today" and "yesterday" are translation keys
// with the time as `time`; older dates are plain text from Intl.
//
// The UI language is "es_CL" or "en_US". Spanish times are on a 24-hour
// clock, as the design shows them ("18:01"); English ones keep the locale's
// clock ("6:01 PM").

export const DATE_TODAY_KEY = "activity_date_today";
export const DATE_YESTERDAY_KEY = "activity_date_yesterday";

const DAY_MS = 24 * 60 * 60 * 1000;

function timestampOf(value) {
    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isNaN(time) ? null : time;
    }
    if (typeof value !== "string" && typeof value !== "number") {
        return null;
    }
    const time = typeof value === "number" ? value : Date.parse(value);
    return Number.isFinite(time) ? time : null;
}

function localeOf(uiLanguage) {
    const language = String(uiLanguage || "en_US").replace("_", "-");
    return language || "en-US";
}

function isSpanish(locale) {
    return /^es\b/i.test(locale);
}

function makeFormat(locale, timeZone, options) {
    const withZone = timeZone ? { ...options, timeZone } : options;
    try {
        return new Intl.DateTimeFormat(locale, withZone);
    } catch {
        // An unknown language or time zone falls back to English in the
        // browser's time zone.
        return new Intl.DateTimeFormat("en-US", options);
    }
}

/**
 * The number of calendar days from `time` to `now` in `dayFormat`'s time
 * zone: 0 the same day, 1 the day before, negative for a later day.
 * `dayFormat` gives the year, month and day of a timestamp.
 */
function calendarDaysBetween(dayFormat, time, now) {
    const dayOf = (timestamp) => {
        const parts = {};
        for (const part of dayFormat.formatToParts(timestamp)) {
            parts[part.type] = Number(part.value);
        }
        return Date.UTC(parts.year, parts.month - 1, parts.day);
    };
    return Math.round((dayOf(now) - dayOf(time)) / DAY_MS);
}

/**
 * The UI language angular-translate is using, or the one it is loading, else
 * "en_US". `translate` is the `$translate` service, or anything with its
 * `use()` and `proposedLanguage()`.
 * @returns {string}
 */
export function uiLanguageOf(translate) {
    return (typeof translate?.use === "function" && translate.use())
        || (typeof translate?.proposedLanguage === "function" && translate.proposedLanguage())
        || "en_US";
}

/**
 * A formatter of activity dates for one language.
 * @param {object} [options]
 * @param {string} [options.uiLanguage] "es_CL" or "en_US".
 * @param {Date|number|string} [options.now] the current time, for "today"
 *   and "yesterday".
 * @param {string} [options.timeZone] an IANA time zone; the browser's when
 *   left out. Tests set it.
 * @returns {{
 *   label: (value: unknown, options?: { withTime?: boolean }) =>
 *     ({ key: string, params: { time: string } }|{ text: string })|null,
 *   full: (value: unknown) => string,
 * }}
 */
export function createActivityDateFormatter({ uiLanguage, now = new Date(), timeZone } = {}) {
    const locale = localeOf(uiLanguage);
    const clock = isSpanish(locale) ? { hourCycle: "h23" } : {};
    const nowTime = timestampOf(now) ?? Date.now();
    const clockTime = { hour: "numeric", minute: "2-digit", ...clock };
    const shortDate = { day: "numeric", month: "short" };
    const withYear = { year: "numeric" };
    const calendarDay = { year: "numeric", month: "numeric", day: "numeric" };
    const format = options => makeFormat(locale, timeZone, options);
    const formats = {
        // The calendar day and year of a timestamp in the time zone, to
        // compare them with today's.
        day:           makeFormat("en-US", timeZone, calendarDay),
        year:          makeFormat("en-US", timeZone, withYear),
        time:          format(clockTime),
        short:         format(shortDate),
        shortYear:     format({ ...shortDate, ...withYear }),
        shortTime:     format({ ...shortDate, ...clockTime }),
        shortYearTime: format({ ...shortDate, ...withYear, ...clockTime }),
        full:          format({ dateStyle: "full", timeStyle: "short", ...clock }),
    };

    return {
        /**
         * What a table cell says: "today" or "yesterday" with the time, as a
         * translation key; else the short date, with the year when it is not
         * the current one, and with the time when `withTime` is set. Null for
         * a missing or invalid date.
         */
        label(value, { withTime = false } = {}) {
            const time = timestampOf(value);
            if (time === null) {
                return null;
            }
            const days = calendarDaysBetween(formats.day, time, nowTime);
            if (days === 0) {
                return { key: DATE_TODAY_KEY, params: { time: formats.time.format(time) } };
            }
            if (days === 1) {
                return { key: DATE_YESTERDAY_KEY, params: { time: formats.time.format(time) } };
            }
            const sameYear = formats.year.format(time) === formats.year.format(nowTime);
            let chosen = sameYear ? formats.short : formats.shortYear;
            if (withTime) {
                chosen = sameYear ? formats.shortTime : formats.shortYearTime;
            }
            return { text: chosen.format(time) };
        },

        /** The full date and time, for the hover title; "" when invalid. */
        full(value) {
            const time = timestampOf(value);
            return time === null ? "" : formats.full.format(time);
        },
    };
}
