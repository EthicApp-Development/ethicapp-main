// Conditions on an external service configuration, read from a capability
// descriptor (ethicapp-ai-additions README, "AI Service Capability
// Descriptor Contract"). Two descriptor keys use them, with one shape and
// one evaluation:
//
// - a session input's `required_when` (#1220): the input is required when a
//   condition holds (backend/helpers/case-session-inputs.js);
// - an instance field's `applies_when` (#1234,
//   ethicapp-ai-additions#319): the field applies when a condition holds.
//   The design editor shows a field only while it applies, a non-applicable
//   field never blocks a save, and adapters send no value for it.
//
// A condition is `{ field, in }`: it holds when the effective value of the
// instance field `field` (the stored value, else the descriptor field's
// default) is one of `in`. A list of conditions holds when any of them does.
// Conditions never chain: a condition never names a field that has its own
// `applies_when`, so one pass evaluates them.
//
// Shared by the backend and the design editor, so both read the same
// configuration the same way. `fields` are normalized descriptor fields
// (backend/services/capability-descriptors.service.js, `appliesWhen` on the
// fields that declare a usable `applies_when`), or raw descriptor fields
// where only `key` and `default` are read.

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The descriptor fields by key, ignoring entries without a string key. */
export function fieldsByKeyOf(fields) {
    return new Map((Array.isArray(fields) ? fields : [])
        .filter(field => isPlainObject(field) && typeof field.key === "string")
        .map(field => [field.key, field]));
}

/**
 * The effective value of a configuration field: the stored value, else the
 * descriptor field's default, else undefined. A stored null counts as unset,
 * as the editor stores no value for "use the default".
 * @param {string} key
 * @param {object|null|undefined} configuration
 * @param {Map<string, object>} fieldsByKey - fieldsByKeyOf(fields)
 */
export function effectiveFieldValue(key, configuration, fieldsByKey) {
    const stored = isPlainObject(configuration) ? configuration[key] : undefined;
    if (stored !== undefined && stored !== null) {
        return stored;
    }
    const field = fieldsByKey.get(key);
    return field && Object.hasOwn(field, "default") ? field.default : undefined;
}

/** Whether one `{ field, in }` condition holds for `configuration`. */
export function conditionHolds(condition, configuration, fieldsByKey) {
    const value = effectiveFieldValue(condition.field, configuration, fieldsByKey);
    return value !== undefined && condition.in.some(entry => entry === value);
}

/** Whether any of `conditions` holds for `configuration`. */
export function anyConditionHolds(conditions, configuration, fieldsByKey) {
    return conditions.some(condition => conditionHolds(condition, configuration, fieldsByKey));
}

/**
 * Whether an instance field applies to `configuration`: always, unless the
 * field has an `appliesWhen`, and then when one of its conditions holds.
 * @param {object} field - A normalized descriptor field.
 * @param {object|null|undefined} configuration - The stored configuration,
 *     or the one a session is created with.
 * @param {Map<string, object>} fieldsByKey - fieldsByKeyOf(fields)
 */
export function fieldApplies(field, configuration, fieldsByKey) {
    const conditions = field?.appliesWhen;
    if (!Array.isArray(conditions) || conditions.length === 0) {
        return true;
    }
    return anyConditionHolds(conditions, configuration, fieldsByKey);
}

/**
 * `configuration` without the values of the fields that do not apply. Keys
 * the descriptor does not define are kept: what to do with them is not a
 * matter of conditions. Without any field that declares `appliesWhen` the
 * result is a copy of `configuration`.
 * @param {object|null|undefined} configuration - What the phase stores.
 * @param {object[]} fields - Normalized descriptor fields.
 * @param {object|null|undefined} [conditionConfiguration] - The
 *     configuration the conditions are evaluated on, when it differs from
 *     `configuration`, such as the body a session is created with, where an
 *     adapter fills fields the phase leaves unset.
 * @returns {object}
 */
export function applicableConfiguration(configuration, fields,
    conditionConfiguration = configuration) {
    if (!isPlainObject(configuration)) {
        return {};
    }
    const fieldsByKey = fieldsByKeyOf(fields);
    return Object.fromEntries(Object.entries(configuration).filter(([key]) => {
        const field = fieldsByKey.get(key);
        return !field || fieldApplies(field, conditionConfiguration, fieldsByKey);
    }));
}
