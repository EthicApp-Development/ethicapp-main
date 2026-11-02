// The design list of the launch wizard's first step (#971, epic #965): which
// of the teacher's designs can be launched, in which order, which ones a
// search finds, and what each row and the preview say about a design.
//
// Plain functions over the payloads of GET /designs and GET /activities, so
// the wizard's controller only wires them to the page.

import { phaseEnabledServiceIds } from "./service-configuration-summary.js";

// Rows shown before "Show more", and how many more each click adds.
export const LAUNCH_LIST_PAGE_SIZE = 20;

function timestampOf(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
}

function designIdOf(value) {
    const id = Number(value);
    return Number.isInteger(id) ? id : null;
}

/** The teacher's own design, not archived: what the launch list draws from. */
function isOwnActiveDesign(design) {
    return design?.userOwned === true && design.archived !== true;
}

/** A design the teacher can launch: their own, not archived and valid. */
export function isLaunchableDesign(design) {
    return isOwnActiveDesign(design) && design.valid === true;
}

/** The launchable designs among `designs`, in their original order. */
export function launchableDesigns(designs) {
    return (Array.isArray(designs) ? designs : []).filter(isLaunchableDesign);
}

/**
 * How many of the teacher's own designs, not archived, are left out of the
 * list because they have errors. The footer says so and links to Diseños.
 */
export function countDesignsWithErrors(designs) {
    return (Array.isArray(designs) ? designs : [])
        .filter(design => isOwnActiveDesign(design) && design.valid !== true)
        .length;
}

/**
 * Design id → { count, lastLaunchedAt } from the teacher's activities
 * (GET /activities). `lastLaunchedAt` is the latest activity `time`, as the
 * server sent it, or null when no activity has a usable time. Activities added
 * by POST /activities carry `designid` (lowercase); both spellings count.
 * @returns {Map<number, { count: number, lastLaunchedAt: string|null }>}
 */
export function launchStatsByDesign(activities) {
    const stats = new Map();
    for (const activity of Array.isArray(activities) ? activities : []) {
        const designId = designIdOf(activity?.designId ?? activity?.designid);
        if (designId === null) {
            continue;
        }

        const entry = stats.get(designId) || { count: 0, lastLaunchedAt: null };
        entry.count += 1;
        const time = timestampOf(activity.time);
        const latest = timestampOf(entry.lastLaunchedAt);
        if (time !== null && (latest === null || time > latest)) {
            entry.lastLaunchedAt = activity.time;
        }
        stats.set(designId, entry);
    }
    return stats;
}

/**
 * When the design was last launched, else when it was created, as a
 * timestamp, or null when neither is known.
 */
export function launchSortTime(design, stats) {
    const launched = timestampOf(stats?.get(designIdOf(design?.id))?.lastLaunchedAt);
    return launched !== null ? launched : timestampOf(design?.createdAt);
}

/**
 * A sorted copy of `designs`, most recent first: by last launch, else by
 * creation (`createdAt`). Designs with neither go after every dated one, and
 * ties and undated designs are broken by id, newest first.
 */
export function orderDesignsForLaunch(designs, stats) {
    return (Array.isArray(designs) ? designs : [])
        .map(design => ({ design, time: launchSortTime(design, stats) }))
        .sort((left, right) => {
            if (left.time !== right.time) {
                if (left.time === null) {
                    return 1;
                }
                if (right.time === null) {
                    return -1;
                }
                return right.time - left.time;
            }
            return (designIdOf(right.design?.id) ?? 0) - (designIdOf(left.design?.id) ?? 0);
        })
        .map(entry => entry.design);
}

/** Lowercase, trimmed, without accents: "Ética" and "etica" match. */
export function normalizeSearchText(value) {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .trim();
}

function designSearchText(design) {
    const tags = Array.isArray(design?.tags) ? design.tags.map(tag => tag?.label) : [];
    return normalizeSearchText([
        design?.metainfo?.title,
        design?.associatedCase?.title,
        ...tags,
    ].filter(Boolean).join(" \u0000 "));
}

/**
 * Whether the design matches the search: every word of `query` appears in its
 * title, its case's title or one of its tags. An empty query matches all.
 */
export function designMatchesLaunchSearch(design, query) {
    const words = normalizeSearchText(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) {
        return true;
    }
    const text = designSearchText(design);
    return words.every(word => text.includes(word));
}

/**
 * A short date in the UI language: "28 oct." or "Oct 28", with the year when
 * it is not the current one. Empty for a missing or invalid date.
 */
export function formatLaunchDate(value, uiLanguage, now = new Date()) {
    const time = timestampOf(value);
    if (time === null) {
        return "";
    }
    const date = new Date(time);
    const locale = String(uiLanguage || "en_US").replace("_", "-");
    const options = { day: "numeric", month: "short" };
    if (date.getFullYear() !== now.getFullYear()) {
        options.year = "numeric";
    }
    try {
        return new Intl.DateTimeFormat(locale, options).format(date);
    } catch {
        return date.toISOString().slice(0, 10);
    }
}

/**
 * What a row says about the design's launches, as a translation key and its
 * parameters: "Launched n times · date", else "Created date · never
 * launched", else "Never launched".
 */
export function launchSummary(design, stats, formatDate) {
    const entry = stats?.get(designIdOf(design?.id));
    if (entry && entry.count > 0) {
        return {
            key: entry.count === 1
                ? "launch_wizard_launched_one"
                : "launch_wizard_launched_other",
            params: { count: entry.count, date: formatDate(entry.lastLaunchedAt) },
        };
    }

    const created = formatDate(design?.createdAt);
    return created
        ? { key: "launch_wizard_created_never_launched", params: { date: created } }
        : { key: "launch_wizard_never_launched", params: {} };
}

/** The translation key for "n phases". */
export function phaseCountKey(count) {
    return count === 1 ? "launch_wizard_phases_one" : "launch_wizard_phases_other";
}

/**
 * One row of the list: the design and what the row shows about it.
 */
export function buildLaunchRow(design, stats, formatDate) {
    const phaseCount = Array.isArray(design?.phases) ? design.phases.length : 0;
    return {
        id:             design.id,
        design,
        title:          design?.metainfo?.title || "",
        caseTitle:      design?.associatedCase?.title || "",
        phaseCount,
        phaseCountKey:  phaseCountKey(phaseCount),
        usesAiServices: design?.usesAiServices === true,
        summary:        launchSummary(design, stats, formatDate),
    };
}

/**
 * The rows of the list: the launchable designs in launch order, narrowed by
 * the search. `total` counts the launchable designs before the search.
 */
export function buildLaunchList(designs, activities, { query = "", formatDate = () => "" } = {}) {
    const stats = launchStatsByDesign(activities);
    const ordered = orderDesignsForLaunch(launchableDesigns(designs), stats);
    return {
        stats,
        total:             ordered.length,
        designsWithErrors: countDesignsWithErrors(designs),
        rows:              ordered
            .filter(design => designMatchesLaunchSearch(design, query))
            .map(design => buildLaunchRow(design, stats, formatDate)),
    };
}

/**
 * The phases of the preview: mode, group size, chat, number of questions and
 * the AI services, named by `serviceName(id)` (null when it has no name).
 */
export function describeDesignPhases(design, serviceName = () => null) {
    return (Array.isArray(design?.phases) ? design.phases : []).map((phase, index) => {
        const isTeam = phase?.mode === "team";
        const size = Number(phase?.stdntAmount);
        const groupSize = isTeam && Number.isInteger(size) && size > 0 ? size : null;
        const questionCount = Array.isArray(phase?.questions) ? phase.questions.length : 0;
        return {
            number:           index + 1,
            isTeam,
            groupSize,
            chat:             isTeam && phase?.chat === true,
            questionCount,
            questionCountKey: questionCountKey(questionCount),
            services:         phaseEnabledServiceIds(phase)
                .map(id => ({ id, name: serviceName(id) })),
        };
    });
}

/** The translation key for "n questions". */
export function questionCountKey(count) {
    return count === 1 ? "launch_wizard_questions_one" : "launch_wizard_questions_other";
}
