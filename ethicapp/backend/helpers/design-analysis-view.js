import { explainDesignAnalysisUnits, selectQuestionUnits } from "./design-analysis-units.js";
import { ARGUMENTATION_TUTOR_SERVICE_ID, expectedTutorModes } from "./tutor-mode.js";

/**
 * What the design view needs next to a design analysis (#865, epic #861):
 * the backend is the single source of truth for the units the analysis
 * covers and for the mode each tutor question can expect, so the view renders
 * them and keeps no copy of either rule.
 *
 * - `units`: the units the producer currently selects for the design
 *   (explainDesignAnalysisUnits(): consumers, the AI service policy and its
 *   per-adapter switches), as `{ id, phaseNumber, questionNumber, text,
 *   textHash }`.
 * - `unitsReason`: why there are none (NO_UNITS_REASONS), else null.
 * - `tutorModes`: when the Argumentation Tutor is one of the usable consumers,
 *   the mode each of its questions would get if its session were created now
 *   (`{ [unit id]: { mode, reason } }`, helpers/tutor-mode.js); else `{}`.
 *
 * @param {Object} args
 * @param {string} args.serviceId - The producer's catalog id.
 * @param {Object} args.designRow - `{ id, case_id, design }`.
 * @param {Object} [dependencies] - Overrides for tests: `explainUnits`,
 *     `tutorModes` and the `registry` both receive.
 * @returns {Promise<{units: Array, unitsReason: string|null, tutorModes: Object}>}
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

    const modes = consumerIds.includes(ARGUMENTATION_TUTOR_SERVICE_ID)
        ? await tutorModes({
            units:    selectQuestionUnits(design, { serviceIds: [ARGUMENTATION_TUTOR_SERVICE_ID] }),
            caseId:   designRow?.case_id ?? null,
            designId: designRow?.id ?? null,
        }, { registry })
        : {};

    return { units, unitsReason: reason, tutorModes: modes };
}
