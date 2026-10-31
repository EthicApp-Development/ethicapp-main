const FRAGMENTS = "/assets/static/views/teacher/fragments";

const phaseDescriptionTemplatesRegistry = {
    semantic_differential: `${FRAGMENTS}/sd-phase-description.template.html`,
    ranking:               `${FRAGMENTS}/ranking-phase-description.template.html`,
};

// The condensed variants for the rail of the activity dashboard (#894):
// features as chips, instructions clamped, questions numbered as the legend of
// the response table's columns.
export const compactPhaseDescriptionTemplatesRegistry = {
    semantic_differential: `${FRAGMENTS}/sd-phase-description-compact.template.html`,
    ranking:               `${FRAGMENTS}/ranking-phase-description-compact.template.html`,
};

export default phaseDescriptionTemplatesRegistry;
