import sdIndividualResultsTable from "./sd-individual-results-table.template.js";
import rankingIndividualResultsTable from "./ranking-individual-results-table.template.js";
import sdGroupResultsTable from "./sd-group-results-table.template.js";
import rankingGroupResultsTable from "./ranking-group-results-table.template.js";

const individualResultsTables = {
    semantic_differential: sdIndividualResultsTable,
    ranking: rankingIndividualResultsTable
};

const groupResultsTables = {
    semantic_differential: sdGroupResultsTable,
    ranking: rankingGroupResultsTable
};

export { individualResultsTables, groupResultsTables };
