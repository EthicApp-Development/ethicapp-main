import sdIndividualResultsTable from "./sd-individual-results-table.js";
import rankingIndividualResultsTable from "./ranking-individual-results-table.js";
import sdGroupResultsTable from "./sd-group-results-table.js";
import rankingGroupResultsTable from "./ranking-group-results-table.js";

let individualResultsTables = {
    semantic_differential: sdIndividualResultsTable,
    ranking: rankingIndividualResultsTable
};

let groupResultsTables = {
    semantic_differential: sdGroupResultsTable,
    ranking: rankingGroupResultsTable
};

export default { individualResultsTables, groupResultsTables };