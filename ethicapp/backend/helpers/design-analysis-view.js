import { explainDesignAnalysisUnits, selectQuestionUnits } from "./design-analysis-units.js";
import {
    ARGUMENTATION_TUTOR_SERVICE_ID,
    expectedTutorModes,
    tutorPhaseModes,
} from "./tutor-mode.js";

/**
 * What the design view needs next to a design analysis (#865, epic #861):
 * the backend is the single source of truth for the units the analysis
 * covers and for the mode each tutor question can expect, so the view renders
 * them and keeps no copy of either rule.
 *
 * - `units`: the units the producer currently selects for the design
 *   (explainDesignAnalysisUnits(): consumers, what they need with each
 *   phase's configuration, the AI service policy and its per-adapter
 *   switches), as `{ id, phaseNumber, questionNumber, text, textHash }`.
 * - `unitsReason`: why there are none (NO_UNITS_REASONS), else null.
 * - `tutorModes`: when the Argumentation Tutor is one of the usable consumers,
 *   the mode each of its questions would get if its session were created now
 *   (`{ [unit id]: { mode, reason, requestedMode } }`, helpers/tutor-mode.js),
 *   including the questions of phases that request the basic mode
 *   (`basic-selected`, #870), which are not units; else `{}`.
 * - `tutorPhases`: under the same condition, the tutor's phases and the mode
 *   each requests (`[{ phaseNumber, requestedMode, reason }]`, `reason`
 *   `basic-selected` or null, tutorPhaseModes()); else `[]`.
 *
 * @param {Object} args
 * @param {string} args.serviceId - The producer's catalog id.
 * @param {Object} args.designRow - `{ id, case_id, design }`.
 * @param {Object} [dependencies] - Overrides for tests: `explainUnits`,
 *     `tutorModes` and the `registry` both receive.
 * @returns {Promise<{units: Array, unitsReason: string|null, tutorModes: Object,
 *     tutorPhases: Array}>}
 */
export async function describeDesignAnalysisUnits(
    { serviceId, designRow },
    {
        explainUnits = explainDesignAnalysisUnits,
        tutorModes = expectedTutorModes,
        registry,
    } = {}
) {
    const design = designRow?.design ?? null;
    const { units, reason, consumerIds } = await explainUnits(
        { producerId: serviceId, design },
        { registry }
    );

    if (!consumerIds.includes(ARGUMENTATION_TUTOR_SERVICE_ID)) {
        return { units, unitsReason: reason, tutorModes: {}, tutorPhases: [] };
    }

    const modes = await tutorModes({
        units:    selectQuestionUnits(design, { serviceIds: [ARGUMENTATION_TUTOR_SERVICE_ID] }),
        design,
        caseId:   designRow?.case_id ?? null,
        designId: designRow?.id ?? null,
    }, { registry });

    return {
        units,
        unitsReason: reason,
        tutorModes:  modes,
        tutorPhases: tutorPhaseModes(design),
    };
}
