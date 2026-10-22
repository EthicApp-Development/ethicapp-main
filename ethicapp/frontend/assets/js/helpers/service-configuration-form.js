// Pure logic behind the external service configuration form (#732).
//
// The form edits `phase.externalServices.configurations[serviceId]` (#729)
// from the service's normalized descriptor fields (#727, #728). Only values
// the teacher sets are stored; an unset field keeps the service default at
// instantiation. Values are checked with the same rules the server applies on
// save (common/modules/service-configuration-rules.js, #731).

import {
    fieldValueProblem,
    isUnset,
} from "../../../../common/modules/service-configuration-rules.js";

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sortOrder(field) {
    return Number.isInteger(field.order) ? field.order : Number.POSITIVE_INFINITY;
}

// Deprecated fields are offered only while a design still stores a value for
// them, so new designs use their replacements (#133, #733).
function isVisible(field, configuration) {
    return field.status !== "deprecated" || !isUnset(configuration[field.key]);
}

/**
 * Visible fields grouped by `group` and ordered by `order` (fields without an
 * order last, ties in descriptor order). Groups follow their first field.
 * @returns {{ group: string|null, fields: object[] }[]}
 */
export function buildFieldSections(fields, configuration = {}) {
    const ordered = fields
        .map((field, index) => ({ field, index }))
        .filter(({ field }) => isVisible(field, configuration))
        .sort((left, right) => (sortOrder(left.field) - sortOrder(right.field))
            || (left.index - right.index))
        .map(({ field }) => field);

    const sections = [];
    for (const field of ordered) {
        const group = field.group || null;
        let section = sections.find(candidate => candidate.group === group);
        if (!section) {
            section = { group, fields: [] };
            sections.push(section);
        }
        section.fields.push(field);
    }
    return sections;
}

/** The control that edits `field`: select, number, checkbox, textarea or text. */
export function controlKind(field) {
    switch (field.type) {
    case "enum":
        return "select";
    case "integer":
    case "number":
        return "number";
    case "boolean":
        return "checkbox";
    case "text":
        return field.validation?.multiline ? "textarea" : "text";
    default:
        return null;
    }
}

/**
 * Enum entries to offer: active ones, plus a deprecated one while it is
 * stored. A stored value the descriptor no longer lists (retired, #733) is
 * offered as `{ value, label, status: "retired" }` so the select can show it;
 * `retiredLabel(value)` names it.
 */
export function enumOptions(field, storedValue, retiredLabel = value => String(value)) {
    const entries = field.validation?.entries || [];
    const options = entries
        .filter(entry => entry.status !== "deprecated" || entry.value === storedValue);
    if (!isUnset(storedValue) && !entries.some(entry => entry.value === storedValue)) {
        options.push({ value: storedValue, label: retiredLabel(storedValue), status: "retired" });
    }
    return options;
}

/** Human-readable default, for placeholders and the "default" select option. */
export function defaultText(field) {
    if (isUnset(field.default)) {
        return "";
    }
    if (field.type === "enum") {
        const entry = (field.validation?.entries || [])
            .find(candidate => candidate.value === field.default);
        return entry ? entry.label : String(field.default);
    }
    return String(field.default);
}

/**
 * The value to store for what a control holds. Empty inputs mean "unset";
 * numbers typed as text become numbers when they parse, so the rules can
 * report anything else as invalid.
 */
export function readControlValue(field, raw) {
    if (raw === undefined || raw === null) {
        return undefined;
    }
    switch (field.type) {
    case "integer":
    case "number": {
        if (raw === "") {
            return undefined;
        }
        if (typeof raw === "number") {
            return raw;
        }
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : raw;
    }
    case "text":
        return raw === "" ? undefined : raw;
    case "enum":
        return raw === "" ? undefined : raw;
    default:
        return raw;
    }
}

/**
 * Stores `value` for `key` in the service's configuration, removing the key
 * when the value is unset and the service entry when it becomes empty.
 * @returns {object|undefined} the service's configuration after the change
 */
export function setConfigurationValue(configurations, serviceId, key, value) {
    if (isUnset(value)) {
        const entry = configurations[serviceId];
        if (isPlainObject(entry)) {
            delete entry[key];
            if (Object.keys(entry).length === 0) {
                delete configurations[serviceId];
            }
        }
        return configurations[serviceId];
    }

    if (!isPlainObject(configurations[serviceId])) {
        configurations[serviceId] = {};
    }
    configurations[serviceId][key] = value;
    return configurations[serviceId];
}

function sameStoredValue(value, storedValue) {
    return (isUnset(value) && isUnset(storedValue)) || value === storedValue;
}

// The problem a stored configuration has for `field`, as the server sees it.
function storedProblem(field, storedConfiguration) {
    const storedValue = storedConfiguration[field.key];
    if (isUnset(storedValue) && Object.keys(storedConfiguration).length === 0) {
        return null;
    }
    return fieldValueProblem(field, storedValue);
}

/**
 * Errors to show for the visible fields, as `{ [key]: code }`. As on the
 * server (#731), a problem the stored design already had for this service
 * (same field, value and code, in any phase) is not an error: the teacher did
 * not introduce it. Required fields count only once the service has a
 * configuration, as the server only checks configurations that exist.
 * @param {object[]} storedConfigurations this service's configurations in the
 *   design as stored (one per phase that has one)
 */
export function configurationErrors(fields, configuration = {}, storedConfigurations = []) {
    const errors = {};
    const hasConfiguration = Object.keys(configuration).length > 0;

    for (const field of fields) {
        if (!isVisible(field, configuration)) {
            continue;
        }
        const value = configuration[field.key];
        if (isUnset(value) && !hasConfiguration) {
            continue;
        }

        const code = fieldValueProblem(field, value);
        const alreadyStored = storedConfigurations.some(stored =>
            sameStoredValue(value, stored[field.key]) && storedProblem(field, stored) === code);
        if (code && !alreadyStored) {
            errors[field.key] = code;
        }
    }
    return errors;
}

/** Translation parameters for an error message about `field`. */
export function errorParameters(field) {
    const validation = field.validation || {};
    return {
        minimum:   validation.minimum,
        maximum:   validation.maximum,
        step:      validation.step,
        maxLength: validation.maxLength,
    };
}

function replacementField(fields, field) {
    const replacement = fields.find(candidate => candidate.key === field.supersededBy
        && candidate.status !== "deprecated");
    return replacement ? { kind: "field", key: replacement.key, label: replacement.label } : null;
}

function replacementValue(field, entry) {
    const replacement = (field.validation?.entries || []).find(candidate =>
        candidate.value === entry.supersededBy && candidate.status !== "deprecated");
    return replacement
        ? { kind: "value", value: replacement.value, label: replacement.label }
        : null;
}

/**
 * Lifecycle notices for the stored values of a service's configuration (#733),
 * matching the warnings the server returns on save (#731):
 * - `deprecated_field`: the field is deprecated (`replacement`: the field that
 *   supersedes it, when the descriptor has it);
 * - `deprecated_value`: the enum value is deprecated (`replacement`: the value
 *   that supersedes it);
 * - `retired_value`: the enum no longer lists the value; the service uses the
 *   field default instead (`defaultText`);
 * - `no_longer_valid`: the value breaks a current rule (`reason`, an error code).
 * Fields the descriptor no longer defines come back in `retiredFields`.
 * @returns {{ byField: object, retiredFields: { key: string, value: * }[] }}
 */
export function settingNotices(fields, configuration = {}) {
    const byField = {};
    const known = new Set(fields.map(field => field.key));

    for (const field of fields) {
        const value = configuration[field.key];
        if (isUnset(value)) {
            continue;
        }

        if (field.status === "deprecated") {
            byField[field.key] = {
                kind:        "deprecated_field",
                replacement: replacementField(fields, field),
            };
            continue;
        }

        const entry = field.type === "enum"
            ? (field.validation?.entries || []).find(candidate => candidate.value === value)
            : null;
        if (entry?.status === "deprecated") {
            byField[field.key] = {
                kind:        "deprecated_value",
                replacement: replacementValue(field, entry),
            };
            continue;
        }

        const code = fieldValueProblem(field, value);
        if (code === "not_in_enum") {
            byField[field.key] = { kind: "retired_value", defaultText: defaultText(field) };
        } else if (code) {
            byField[field.key] = { kind: "no_longer_valid", reason: code };
        }
    }

    const retiredFields = Object.entries(configuration)
        .filter(([key, value]) => !known.has(key) && !isUnset(value))
        .map(([key, value]) => ({ key, value }));

    return { byField, retiredFields };
}
