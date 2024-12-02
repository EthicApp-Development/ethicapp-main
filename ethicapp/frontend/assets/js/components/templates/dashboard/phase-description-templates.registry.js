import sdPhaseDescriptionTemplate from "./sd-phase-description.template.js";
import rankingPhaseDescriptionTemplate from "./ranking-phase-description.template.js";

const phaseDescriptionTemplatesRegistry = {
    semantic_differential: sdPhaseDescriptionTemplate,
    ranking: rankingPhaseDescriptionTemplate
};

export default phaseDescriptionTemplatesRegistry;