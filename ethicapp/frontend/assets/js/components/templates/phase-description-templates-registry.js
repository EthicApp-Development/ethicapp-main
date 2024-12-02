import sdPhaseDescriptionTemplate from "./sd-phase-description.js";
import rankingPhaseDescriptionTemplate from "./ranking-phase-description.js";

const phaseDescriptionTemplatesRegistry = {
    semantic_differential: sdPhaseDescriptionTemplate,
    ranking: rankingPhaseDescriptionTemplate
};

export default phaseDescriptionTemplatesRegistry;