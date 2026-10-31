// The two-column layout of the teacher's activity dashboard (#894, epic
// #892): which phase and which main tab are selected, the phase navigator's
// rows, how many participants answered a phase, and the participant search
// over the response tables. Plain functions over the dashboard's phase data
// (`{ descriptor, state }` per started phase) and the design's phases.

import { phaseModeKey } from "./activity-bar.js";

export const DASHBOARD_TABS = Object.freeze(["responses", "case", "design", "participants"]);
export const DEFAULT_DASHBOARD_TAB = "responses";

// From this viewport width the rail is wide enough to open the "This phase"
// card whole; below it the card starts collapsed to the questions.
export const WIDE_RAIL_MIN_WIDTH = 1600;

// The keys a response table row keeps its answers in: `r1`, `r2`…
const ANSWER_KEY = /^r\d+$/;

// What a phase navigator row shows.
const NAVIGATOR_ROW_FIELDS = Object.freeze([
    "number", "mode", "phaseId", "started", "current", "answered", "participants", "progress",
]);

// The main tab to show: a known tab, or the responses.
export function dashboardTab(tab) {
    return DASHBOARD_TABS.includes(tab) ? tab : DEFAULT_DASHBOARD_TAB;
}

// Whether the "This phase" card starts open at this viewport width.
export function defaultPhaseContextExpanded(viewportWidth) {
    return Number(viewportWidth) >= WIDE_RAIL_MIN_WIDTH;
}

// A row of a student, not a group's summary row.
export function isParticipantRow(row) {
    return Boolean(row) && typeof row === "object" && !row.groupStatistics;
}

function hasAnswer(row) {
    return Object.keys(row).some(key => ANSWER_KEY.test(key)
        && row[key] !== null && row[key] !== undefined && row[key] !== "");
}

// How many participants of a phase answered at least one of its questions,
// out of the participants in its table.
export function phaseResponseCounts(phaseData) {
    const rows = Array.isArray(phaseData?.state) ? phaseData.state : [];
    const participants = rows.filter(isParticipantRow);

    return {
        answered:     participants.filter(hasAnswer).length,
        participants: participants.length,
    };
}

function phaseId(phaseData) {
    return phaseData?.descriptor?.id ?? null;
}

function samePhaseId(left, right) {
    return left !== null && left !== undefined && right !== null && right !== undefined
        && Number(left) === Number(right);
}

function findStartedPhase(startedPhases, id) {
    return (Array.isArray(startedPhases) ? startedPhases : [])
        .find(phaseData => samePhaseId(phaseId(phaseData), id)) || null;
}

// The phase to select when the dashboard loads: the current phase, or the
// last phase started when the current one is not loaded yet. Null before the
// first phase starts.
export function defaultSelectedPhaseId(startedPhases, currentPhaseId) {
    const phases = Array.isArray(startedPhases) ? startedPhases.filter(phaseId) : [];
    if (phases.length === 0) {
        return null;
    }

    const current = findStartedPhase(phases, currentPhaseId);
    if (current) {
        return phaseId(current);
    }

    const number = phaseData => Number(phaseData.descriptor.number);
    const last = phases.reduce((latest, phaseData) =>
        number(phaseData) > number(latest) ? phaseData : latest);
    return phaseId(last);
}

// The selected phase, kept while it is one of the started phases; otherwise
// the default one.
export function resolveSelectedPhaseId(selectedPhaseId, startedPhases, currentPhaseId) {
    const selected = findStartedPhase(startedPhases, selectedPhaseId);
    return selected ? phaseId(selected) : defaultSelectedPhaseId(startedPhases, currentPhaseId);
}

// The started phase with this id, or null.
export function selectedPhaseData(startedPhases, selectedPhaseId) {
    return findStartedPhase(startedPhases, selectedPhaseId);
}

function phaseMode(mode) {
    return mode === "team" ? "team" : "individual";
}

// One row per phase of the design, for the phase navigator: its number and
// mode, whether it started, whether it is the activity's current phase, and
// how many participants answered it. Phases that have not started have no id,
// no counts and cannot be selected. A started phase missing from the design
// is listed too.
export function phaseNavigatorRows(designPhases, startedPhases, currentPhaseId) {
    const design = Array.isArray(designPhases) ? designPhases : [];
    const started = (Array.isArray(startedPhases) ? startedPhases : []).filter(phaseId);
    const startedByNumber = new Map(started.map(phaseData =>
        [Number(phaseData.descriptor.number), phaseData]));
    const lastNumber = Math.max(design.length, ...startedByNumber.keys());
    const rows = [];

    for (let number = 1; number <= lastNumber; number++) {
        const phaseData = startedByNumber.get(number) || null;
        const mode = phaseMode(phaseData?.descriptor?.mode ?? design[number - 1]?.mode);
        const row = {
            number,
            mode,
            modeKey:      phaseModeKey(mode),
            phaseId:      phaseId(phaseData),
            started:      Boolean(phaseData),
            current:      Boolean(phaseData) && samePhaseId(phaseId(phaseData), currentPhaseId),
            answered:     null,
            participants: null,
            progress:     0,
        };

        if (phaseData) {
            const counts = phaseResponseCounts(phaseData);
            row.answered = counts.answered;
            row.participants = counts.participants;
            row.progress = counts.participants > 0
                ? Math.round(100 * counts.answered / counts.participants)
                : 0;
        }

        rows.push(row);
    }

    return rows;
}

// Whether two lists of navigator rows show the same, so a component can keep
// its rows while nothing changed and the digest settles.
export function sameNavigatorRows(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
        return false;
    }

    return left.every((row, index) => NAVIGATOR_ROW_FIELDS
        .every(field => row[field] === right[index][field]));
}

// Text for a case- and accent-insensitive comparison: "Álvarez" matches
// "alvarez".
export function normalizeSearchText(text) {
    return String(text ?? "")
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLocaleLowerCase()
        .trim();
}

// Whether a participant's name contains the search.
export function matchesParticipantQuery(name, query) {
    const needle = normalizeSearchText(query);
    return needle === "" || normalizeSearchText(name).includes(needle);
}

// The keys a row's group is known by: its id and its number. A group's
// summary row may carry only the number, as a string.
function groupKeys(row) {
    const keys = [];
    if (row.groupId !== null && row.groupId !== undefined) {
        keys.push(`id:${row.groupId}`);
    }
    if (row.groupNumber !== null && row.groupNumber !== undefined && row.groupNumber !== "") {
        keys.push(`number:${row.groupNumber}`);
    }
    return keys;
}

// The rows of a response table whose participant's name contains the search.
// A group's summary row stays while its name matches or one of its members
// does, so a member is never shown without their group's statistics. With an
// empty search the same array comes back, so the table keeps its rows.
export function filterRowsByParticipant(rows, query) {
    if (!Array.isArray(rows) || normalizeSearchText(query) === "") {
        return rows;
    }

    const matchingGroups = new Set(rows
        .filter(row => isParticipantRow(row) && matchesParticipantQuery(row.userName, query))
        .flatMap(groupKeys));

    return rows.filter(row => {
        if (isParticipantRow(row)) {
            return matchesParticipantQuery(row.userName, query);
        }
        if (!row || typeof row !== "object") {
            return false;
        }

        return matchesParticipantQuery(row.groupName, query)
            || groupKeys(row).some(key => matchingGroups.has(key));
    });
}

// How many participants of a phase the search leaves in its table.
export function participantMatchCount(phaseData, query) {
    const rows = Array.isArray(phaseData?.state) ? phaseData.state : [];
    return rows.filter(row => isParticipantRow(row)
        && matchesParticipantQuery(row.userName, query)).length;
}
