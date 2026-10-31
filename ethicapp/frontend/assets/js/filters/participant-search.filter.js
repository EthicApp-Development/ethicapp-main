// `rows | participantSearch:query`: the rows of a dashboard response table
// whose participant's name contains the search, with their group's summary
// rows (#894, epic #892). An empty search keeps the same array.

import { filterRowsByParticipant } from "../helpers/activity-dashboard.js";

export function participantSearchFilter() {
    return (rows, query) => filterRowsByParticipant(rows, query);
}
