import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    isPhaseValid,
    validateDesign,
} from "../phase-validation-helpers.js";

describe("phase validation helpers", () => {
    it("marks a complete semantic differential design as valid", () => {
        const result = validateDesign({
            type:   "semantic_differential",
            phases: [
                {
                    mode:         "individual",
                    instructions: "Read the prompt and answer.",
                    questions:    [
                        {
                            q_text:     "How fair was this decision?",
                            ans_format: {
                                l_pole:                                "Unfair",
                                r_pole:                                "Fair",
                                values:                                7,
                                just_required:                         true,
                                justification_minimum_length_required: true,
                                min_just_length:                       5,
                            },
                        },
                    ],
                },
            ],
        });

        assert.equal(result.valid, true);
        assert.deepEqual(result.validationErrors, { global: [], phases: {} });
    });

    it("reports and clears item-level errors based on the current design state", () => {
        const incompleteResult = validateDesign({
            type:   "semantic_differential",
            phases: [
                {
                    mode:      "individual",
                    questions: [
                        {
                            q_text:     "",
                            ans_format: {
                                l_pole:        "",
                                r_pole:        "",
                                values:        7,
                                just_required: false,
                            },
                        },
                    ],
                },
            ],
        });

        assert.equal(incompleteResult.valid, false);
        assert.deepEqual(
            incompleteResult.validationErrors.phases.phase_1.items.item_1,
            [
                "edit_error_sd_missing_question_text",
                "edit_error_sd_missing_value_left_pole",
                "edit_error_sd_missing_value_right_pole",
            ],
        );

        const completeResult = validateDesign({
            type:   "semantic_differential",
            phases: [
                {
                    mode:      "individual",
                    questions: [
                        {
                            q_text:     "Question text",
                            ans_format: {
                                l_pole:        "Left",
                                r_pole:        "Right",
                                values:        7,
                                just_required: false,
                            },
                        },
                    ],
                },
            ],
        });

        assert.equal(completeResult.valid, true);
        assert.deepEqual(completeResult.validationErrors.phases, {});
    });

    it("keeps preserve grouping invalid on the first phase", () => {
        const result = validateDesign({
            type:   "ranking",
            phases: [
                {
                    mode:               "team",
                    grouping_algorithm: "preserve",
                    roles:              [
                        {
                            name:                   "Role A",
                            justification_required: false,
                        },
                    ],
                },
            ],
        });

        assert.equal(result.valid, false);
        assert.deepEqual(
            result.validationErrors.phases.phase_1.groupingConfig,
            [
                "error_cannot_preserve_groups_phase1",
                "error_no_previous_grouping",
            ],
        );
    });

    it("recognizes an empty phase error bucket as valid", () => {
        assert.equal(isPhaseValid({
            items:             {},
            groupingConfig:    [],
            phaseInstructions: [],
            other:             [],
        }), true);
    });
});
