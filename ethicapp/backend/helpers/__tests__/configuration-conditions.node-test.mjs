// The shared evaluation of `{ field, in }` conditions (#1234), used for a
// session input's `required_when` (#1220) and an instance field's
// `applies_when` (ethicapp-ai-additions#319), by the backend and the design
// editor alike (common/modules/configuration-conditions.js).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    anyConditionHolds,
    applicableConfiguration,
    effectiveFieldValue,
    fieldApplies,
    fieldsByKeyOf,
} from "../../../common/modules/configuration-conditions.js";

const COVERAGE_ONLY = Object.freeze([{ field: "pipeline_type", in: ["contentCoverage"] }]);

const FIELDS = Object.freeze([
    { key: "pipeline_type", type: "enum", default: "standard" },
    { key: "llm_tier", type: "enum", default: "basic" },
    { key: "topic_tracking", type: "boolean", default: true, appliesWhen: COVERAGE_ONLY },
]);
const BY_KEY = fieldsByKeyOf(FIELDS);
const TOPIC_TRACKING = FIELDS[2];

describe("effectiveFieldValue", () => {
    it("is the stored value, else the descriptor default", () => {
        assert.equal(effectiveFieldValue("pipeline_type", { pipeline_type: "contentCoverage" }, BY_KEY),
            "contentCoverage");
        assert.equal(effectiveFieldValue("pipeline_type", {}, BY_KEY), "standard");
        assert.equal(effectiveFieldValue("pipeline_type", null, BY_KEY), "standard");
    });

    it("reads a stored null as unset, and an unknown field as undefined", () => {
        assert.equal(effectiveFieldValue("pipeline_type", { pipeline_type: null }, BY_KEY), "standard");
        assert.equal(effectiveFieldValue("mode", { other: 1 }, BY_KEY), undefined);
    });
});

describe("anyConditionHolds", () => {
    it("holds when any condition holds on the effective value", () => {
        const conditions = [
            { field: "llm_tier", in: ["advanced"] },
            { field: "pipeline_type", in: ["contentCoverage", "other"] },
        ];
        assert.equal(anyConditionHolds(conditions, { pipeline_type: "contentCoverage" }, BY_KEY), true);
        assert.equal(anyConditionHolds(conditions, { llm_tier: "advanced" }, BY_KEY), true);
        assert.equal(anyConditionHolds(conditions, {}, BY_KEY), false);
    });

    it("compares strictly, without coercion", () => {
        assert.equal(anyConditionHolds([{ field: "count", in: ["1"] }], { count: 1 }, BY_KEY), false);
    });
});

describe("fieldApplies", () => {
    it("always holds for a field without appliesWhen", () => {
        assert.equal(fieldApplies(FIELDS[1], {}, BY_KEY), true);
        assert.equal(fieldApplies({ ...FIELDS[1], appliesWhen: [] }, {}, BY_KEY), true);
    });

    it("follows the stored value, else the default, of the named field", () => {
        assert.equal(fieldApplies(TOPIC_TRACKING, { pipeline_type: "contentCoverage" }, BY_KEY), true);
        assert.equal(fieldApplies(TOPIC_TRACKING, { pipeline_type: "standard" }, BY_KEY), false);
        assert.equal(fieldApplies(TOPIC_TRACKING, {}, BY_KEY), false);

        const coverageByDefault = fieldsByKeyOf([
            { ...FIELDS[0], default: "contentCoverage" }, TOPIC_TRACKING,
        ]);
        assert.equal(fieldApplies(TOPIC_TRACKING, {}, coverageByDefault), true);
    });
});

describe("applicableConfiguration", () => {
    it("drops the values of fields that do not apply, keeping the others and unknown keys", () => {
        assert.deepEqual(
            applicableConfiguration({ pipeline_type: "standard", topic_tracking: false, legacy: 1 },
                FIELDS),
            { pipeline_type: "standard", legacy: 1 });
        assert.deepEqual(
            applicableConfiguration({ pipeline_type: "contentCoverage", topic_tracking: false },
                FIELDS),
            { pipeline_type: "contentCoverage", topic_tracking: false });
    });

    it("can evaluate the conditions on another configuration", () => {
        assert.deepEqual(
            applicableConfiguration({ topic_tracking: false }, FIELDS,
                { pipeline_type: "contentCoverage", topic_tracking: false }),
            { topic_tracking: false });
    });

    it("copies the configuration when no field declares appliesWhen", () => {
        const configuration = { pipeline_type: "standard", llm_tier: "advanced" };
        const result = applicableConfiguration(configuration, FIELDS.slice(0, 2));

        assert.deepEqual(result, configuration);
        assert.notEqual(result, configuration);
        assert.deepEqual(applicableConfiguration(null, FIELDS), {});
    });
});
