// Read-only presentation of a phase's external services and their settings,
// for the design and activity views (#757). The editor's form helpers (#732,
// #733) supply the display text and the lifecycle notices, so both screens
// say the same thing about the same settings.

import { isUnset } from "../../../../common/modules/service-configuration-rules.js";
import {
    buildFieldSections,
    defaultText,
    errorParameters,
    settingNotices,
} from "./service-configuration-form.js";

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The phase's enabled service ids, trimmed and without duplicates. */
export function phaseEnabledServiceIds(phase) {
    const enabled = phase?.externalServices?.enabledServiceIds;
    const ids = [];
    for (const id of Array.isArray(enabled) ? enabled : []) {
        const trimmed = String(id).trim();
        if (trimmed && !ids.includes(trimmed)) {
            ids.push(trimmed);
        }
    }
    return ids;
}

/** What the phase stores for `serviceId` (#729), or `{}`. */
export function phaseServiceConfiguration(phase, serviceId) {
    const stored = phase?.externalServices?.configurations?.[serviceId];
    return isPlainObject(stored) ? stored : {};
}

/**
 * A service's name in `language`: its UI translation (#723), else its
 * descriptor name, else its id.
 */
export function serviceDisplayName(service, serviceId, language) {
    return service?.ui?.translations?.[language]?.label
        || service?.descriptor?.name
        || serviceId;
}

function enumLabel(field, value) {
    const entry = (field.validation?.entries || []).find(candidate => candidate.value === value);
    return entry ? entry.label : String(value);
}

// `{ text, booleanValue }`: booleans are translated by the view.
function displayValue(field, value) {
    if (field.type === "boolean" && typeof value === "boolean") {
        return { text: null, booleanValue: value };
    }
    if (field.type === "enum") {
        return { text: enumLabel(field, value), booleanValue: null };
    }
    return { text: String(value), booleanValue: null };
}

/**
 * One row per visible descriptor field, in the form's order: its label and the
 * stored value, or the service default when nothing is stored (`isDefault`).
 * `notice` is the field's lifecycle notice (#733), if any. Settings the
 * descriptor no longer defines come back in `retiredFields`.
 * @returns {{ rows: object[], retiredFields: { key: string, value: * }[] }}
 */
export function summarizeServiceSettings(fields, configuration = {}) {
    const notices = settingNotices(fields, configuration);
    const rows = [];

    for (const section of buildFieldSections(fields, configuration)) {
        for (const field of section.fields) {
            const value = configuration[field.key];
            const isDefault = isUnset(value);
            const shown = isDefault
                ? { text: defaultText(field) || null, booleanValue: null }
                : displayValue(field, value);
            if (isDefault && field.type === "boolean" && typeof field.default === "boolean") {
                shown.text = null;
                shown.booleanValue = field.default;
            }

            rows.push({
                key:         field.key,
                label:       field.label,
                group:       section.group,
                isDefault,
                ...shown,
                notice:      notices.byField[field.key] || null,
                errorParams: errorParameters(field),
            });
        }
    }

    return { rows, retiredFields: notices.retiredFields };
}

/**
 * The stored settings as `key: value` rows, for when the service cannot
 * provide labels: strings as they are, anything else as JSON.
 */
export function storedSettingRows(configuration = {}) {
    return Object.entries(configuration)
        .filter(([, value]) => !isUnset(value))
        .map(([key, value]) => ({
            key,
            text: typeof value === "string" ? value : JSON.stringify(value),
        }));
}
