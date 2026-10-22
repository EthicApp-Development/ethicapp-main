const FRAGMENTS = "/assets/static/views/teacher/fragments";

const individualResultsTables = {
    semantic_differential: `${FRAGMENTS}/sd-individual-results-table.template.html`,
    ranking:               `${FRAGMENTS}/ranking-individual-results-table.template.html`,
};

const groupResultsTables = {
    semantic_differential: `${FRAGMENTS}/sd-group-results-table.template.html`,
    ranking:               `${FRAGMENTS}/ranking-group-results-table.template.html`,
};

export { individualResultsTables, groupResultsTables };
