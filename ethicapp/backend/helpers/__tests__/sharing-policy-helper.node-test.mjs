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
    getDesignAuthorName,
    getDesignTitle,
    getLocalizedCopyLabel,
    hasValidCaseSharingFieldTypes,
    normalizeCaseSharingFields,
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

test("a design is attributed to its creator, or to the author it keeps once the creator is forgotten (#877)", () => {
    const creator = {
        creator_firstname: "Tom",
        creator_lastname:  "Teacher",
        creator_name:      "Tom Teacher",
        creator_email:     "tom@example.test",
    };
    const document = { metainfo: { author: "Tomás Teacher", email: "tom@example.test" } };

    assert.equal(getDesignAuthorName(creator, document), "Tom Teacher");
    assert.equal(
        getDesignAuthorName({
            creator_firstname:  "Former",
            creator_lastname:   "Teacher 31",
            creator_name:       "Former Teacher 31",
            creator_email:      "anon-teacher-31@anonymous.invalid",
            creator_anonymized: true,
        }, document),
        "Tomás Teacher"
    );
    // Without a kept author, the anonymous name, never the anonymous address.
    assert.equal(
        getDesignAuthorName({
            creator_email:      "anon-teacher-31@anonymous.invalid",
            creator_anonymized: true,
        }, { metainfo: {} }),
        ""
    );
});

const EXISTING_CASE = {
    visibility:           "private",
    license_code:         "CC-BY-4.0",
    attribution_text:     "By Ada",
    rights_status:        "open_license",
    license_notes:        "Notes",
    permission_statement: "Permission",
    commercial_source:    "Source",
};

test("normalizeCaseSharingFields reads snake and camel case sharing fields (#1014)", () => {
    const sharing = {
        visibility:          "public",
        licenseCode:         "CC-BY-SA-4.0",
        attributionText:     "By Grace",
        rightsStatus:        "used_with_permission",
        licenseNotes:        "New notes",
        permissionStatement: "Granted",
        commercialSource:    "",
    };
    const snakeCase = {
        visibility:           "public",
        license_code:         "CC-BY-SA-4.0",
        attribution_text:     "By Grace",
        rights_status:        "used_with_permission",
        license_notes:        "New notes",
        permission_statement: "Granted",
        commercial_source:    "",
    };

    assert.deepEqual(normalizeCaseSharingFields(sharing, EXISTING_CASE), sharing);
    assert.deepEqual(normalizeCaseSharingFields(snakeCase, EXISTING_CASE), sharing);
});

test("normalizeCaseSharingFields keeps the case's values for absent or invalid fields", () => {
    assert.deepEqual(normalizeCaseSharingFields({}, EXISTING_CASE), {
        visibility:          "private",
        licenseCode:         "CC-BY-4.0",
        attributionText:     "By Ada",
        rightsStatus:        "open_license",
        licenseNotes:        "Notes",
        permissionStatement: "Permission",
        commercialSource:    "Source",
    });

    const invalid = normalizeCaseSharingFields(
        { visibility: "shared", licenseCode: "  ", rightsStatus: "private_use_only" },
        EXISTING_CASE
    );
    assert.equal(invalid.visibility, "private");
    assert.equal(invalid.licenseCode, "CC-BY-4.0");
    assert.equal(invalid.rightsStatus, "open_license");
});

test("normalizeCaseSharingFields falls back to the case defaults for an unset case", () => {
    const sharing = normalizeCaseSharingFields({}, {});

    assert.equal(sharing.visibility, PRIVATE_VISIBILITY);
    assert.equal(sharing.licenseCode, CASE_DEFAULT_LICENSE);
    assert.equal(sharing.attributionText, null);
    assert.equal(sharing.licenseNotes, null);
});

test("hasValidCaseSharingFieldTypes accepts strings and null, and nothing else", () => {
    assert.equal(hasValidCaseSharingFieldTypes({}), true);
    assert.equal(hasValidCaseSharingFieldTypes({ visibility: "public", licenseNotes: null }), true);
    assert.equal(hasValidCaseSharingFieldTypes({ title: 3 }), true);
    assert.equal(hasValidCaseSharingFieldTypes({ attributionText: { text: "x" } }), false);
    assert.equal(hasValidCaseSharingFieldTypes({ license_code: 4 }), false);
    assert.equal(hasValidCaseSharingFieldTypes([]), false);
    assert.equal(hasValidCaseSharingFieldTypes(null), false);
    assert.equal(hasValidCaseSharingFieldTypes("public"), false);
});
