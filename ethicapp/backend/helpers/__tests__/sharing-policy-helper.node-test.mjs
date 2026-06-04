import assert from "node:assert/strict";
import test from "node:test";

import {
    CASE_DEFAULT_LICENSE,
    DESIGN_DEFAULT_LICENSE,
    COMMERCIAL_LICENSE_RIGHTS_STATUS,
    OPEN_LICENSE_RIGHTS_STATUS,
    PRIVATE_VISIBILITY,
    PUBLIC_VISIBILITY,
    buildAttributionText,
    buildLocalizedCopyTitle,
    getCaseAuthorName,
    getDesignTitle,
    getLocalizedCopyLabel,
    normalizeLanguageCode,
    normalizeLicenseCode,
    normalizeRightsStatus,
    normalizeVisibility,
} from "../sharing-policy-helper.js";

test("normalizeVisibility only accepts public and private values", () => {
    assert.equal(normalizeVisibility("public"), PUBLIC_VISIBILITY);
    assert.equal(normalizeVisibility("private"), PRIVATE_VISIBILITY);
    assert.equal(normalizeVisibility("shared"), PRIVATE_VISIBILITY);
    assert.equal(normalizeVisibility(undefined, PUBLIC_VISIBILITY), PUBLIC_VISIBILITY);
});

test("normalizeLicenseCode applies resource-specific defaults", () => {
    assert.equal(normalizeLicenseCode("", CASE_DEFAULT_LICENSE), CASE_DEFAULT_LICENSE);
    assert.equal(normalizeLicenseCode(null, DESIGN_DEFAULT_LICENSE), DESIGN_DEFAULT_LICENSE);
    assert.equal(normalizeLicenseCode("CC-BY-4.0", DESIGN_DEFAULT_LICENSE), "CC-BY-4.0");
});

test("normalizeLanguageCode applies the resource language default", () => {
    assert.equal(normalizeLanguageCode("en_US"), "en_US");
    assert.equal(normalizeLanguageCode(""), "es_CL");
});

test("normalizeRightsStatus only accepts explicit rights categories", () => {
    assert.equal(normalizeRightsStatus("open_license"), OPEN_LICENSE_RIGHTS_STATUS);
    assert.equal(normalizeRightsStatus("commercial_license"), COMMERCIAL_LICENSE_RIGHTS_STATUS);
    assert.equal(normalizeRightsStatus("private_use_only"), "own_work");
});

test("buildAttributionText creates a compact attribution snapshot", () => {
    assert.equal(
        buildAttributionText({
            title:       "Deliberation scenario",
            author:      "Ada Lovelace",
            licenseCode: "CC-BY-SA-4.0",
        }),
        "\"Deliberation scenario\", by Ada Lovelace, licensed CC-BY-SA-4.0"
    );
});

test("title and author helpers normalize existing case and design shapes", () => {
    assert.equal(getDesignTitle({ metainfo: { title: "Design title" } }), "Design title");
    assert.equal(getDesignTitle({ title: "Flat title" }), "Flat title");
    assert.equal(getDesignTitle({}), "Untitled design");
    assert.equal(getCaseAuthorName({ author_firstname: "Jane", author_lastname: "Doe" }), "Jane Doe");
});

test("localized copy title helpers use the content language", () => {
    assert.equal(getLocalizedCopyLabel("es_CL"), "copia");
    assert.equal(getLocalizedCopyLabel("en_US"), "copy");
    assert.equal(buildLocalizedCopyTitle("Caso base", "es_CL"), "Caso base (copia)");
    assert.equal(buildLocalizedCopyTitle("Base case", "en_US", 2), "Base case (copy 2)");
});
