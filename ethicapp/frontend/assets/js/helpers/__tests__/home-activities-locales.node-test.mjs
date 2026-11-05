// The texts of the home's two activities sections (#1096): "Actividades en
// curso", "Terminadas recientemente" and their links to Actividades.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const LOCALES = new URL("../../../locales/", import.meta.url);
const LOCALE_NAMES = ["es_CL", "en_US"];
const source = name => readFileSync(new URL(`${name}.json`, LOCALES), "utf8");
const catalog = name => JSON.parse(source(name));

const HOME_ACTIVITIES_KEYS = [
    "home_activities_ongoing_title",
    "home_activities_finished_title",
    "home_activities_view_ongoing_one",
    "home_activities_view_ongoing_other",
    "home_activities_view_finished_one",
    "home_activities_view_finished_other",
    "home_activities_ongoing_count_title",
];

const COUNTED_KEYS = [
    "home_activities_view_ongoing_other",
    "home_activities_view_finished_other",
    "home_activities_ongoing_count_title",
];

function placeholders(text) {
    return [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/gu)].map(match => match[1]).sort();
}

describe("home activities translations", () => {
    it("has every key in both locales, once", () => {
        for (const locale of LOCALE_NAMES) {
            const texts = catalog(locale);
            const raw = source(locale);
            for (const key of HOME_ACTIVITIES_KEYS) {
                assert.equal(typeof texts[key], "string", `${locale}: ${key}`);
                assert.notEqual(texts[key].trim(), "", `${locale}: ${key}`);
                const occurrences = raw.split(`"${key}":`).length - 1;
                assert.equal(occurrences, 1, `${locale}: ${key} appears once`);
            }
        }
    });

    it("uses the same placeholders in both locales", () => {
        const [spanish, english] = LOCALE_NAMES.map(catalog);
        for (const key of HOME_ACTIVITIES_KEYS) {
            assert.deepEqual(placeholders(spanish[key]), placeholders(english[key]), key);
        }
    });

    it("puts the count in the plural and count forms, and not in the singular ones", () => {
        for (const locale of LOCALE_NAMES) {
            const texts = catalog(locale);
            for (const key of HOME_ACTIVITIES_KEYS) {
                const expected = COUNTED_KEYS.includes(key) ? ["count"] : [];
                assert.deepEqual(placeholders(texts[key]), expected, `${locale}: ${key}`);
            }
        }
    });

    it("pairs every singular form with a plural one", () => {
        const texts = catalog("es_CL");
        for (const key of HOME_ACTIVITIES_KEYS.filter(name => name.endsWith("_one"))) {
            assert.equal(typeof texts[key.replace(/_one$/u, "_other")], "string", key);
        }
    });

    it("says activities and participants, never students", () => {
        for (const locale of LOCALE_NAMES) {
            const texts = catalog(locale);
            for (const key of HOME_ACTIVITIES_KEYS) {
                assert.doesNotMatch(texts[key], /estudiant|student/iu, `${locale}: ${key}`);
            }
        }
    });
});
