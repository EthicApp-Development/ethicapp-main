// Rules for one external service configuration against the normalized fields
// of its capability descriptor (#731, #732). Shared by the backend, which
// validates designs on save, and the design editor, which validates as the
// teacher types, so both apply exactly the same checks.
//
// `fields` use the shape of ethicapp/backend/services/capability-descriptors.service.js:
// { key, type, required, default, status, supersededBy, validation }, where
// `validation` is { entries } for enum, { minimum, maximum, step } for integer
// and number, { maxLength, pattern, multiline } for text, {} for boolean.

const STEP_TOLERANCE = 1e-9;

export function isUnset(value) {
    return value === undefined || value === null;
}

function typeProblem(field, value) {
    switch (field.type) {
    case "integer":
        return Number.isInteger(value) ? null : "invalid_type";
    case "number":
        return typeof value === "number" && Number.isFinite(value) ? null : "invalid_type";
    case "boolean":
        return typeof value === "boolean" ? null : "invalid_type";
    case "text":
        return typeof value === "string" ? null : "invalid_type";
    case "enum":
        return ["string", "number", "boolean"].includes(typeof value) ? null : "invalid_type";
    default:
        return "invalid_type";
    }
}

function numericProblem(validation, value) {
    const { minimum, maximum, step } = validation;
    if (typeof minimum === "number" && value < minimum) {
        return "below_minimum";
    }
    if (typeof maximum === "number" && value > maximum) {
        return "above_maximum";
    }
    if (typeof step === "number" && step > 0) {
        const steps = (value - (typeof minimum === "number" ? minimum : 0)) / step;
        if (Math.abs(steps - Math.round(steps)) > STEP_TOLERANCE) {
            return "step_mismatch";
        }
    }
    return null;
}

function compilePattern(pattern) {
    try {
        return new RegExp(pattern, "u");
    } catch {
        return null; // a pattern this runtime cannot compile is not enforced
    }
}

function textProblem(validation, value) {
    const { maxLength, pattern } = validation;
    if (Number.isInteger(maxLength) && [...value].length > maxLength) {
        return "too_long";
    }
    const expression = typeof pattern === "string" ? compilePattern(pattern) : null;
    if (expression && !expression.test(value)) {
        return "pattern_mismatch";
    }
    return null;
}

function enumProblem(field, value) {
    return field.validation.entries.some(entry => entry.value === value) ? null : "not_in_enum";
}

// The problem with a value of the right type, if any.
function valueProblem(field, value) {
    switch (field.type) {
    case "enum":
        return enumProblem(field, value);
    case "integer":
    case "number":
        return numericProblem(field.validation, value);
    case "text":
        return textProblem(field.validation, value);
    default:
        return null;
    }
}

/**
 * The error code for one value of `field`, or null when it is valid. Unset
 * values (undefined, null) are valid unless the field is required.
 */
export function fieldValueProblem(field, value) {
    if (isUnset(value)) {
        return field.required ? "required" : null;
    }
    return typeProblem(field, value) ?? valueProblem(field, value);
}

function deprecation(key, code, value, supersededBy) {
    return { field: key, code, value, supersededBy: supersededBy ?? null };
}

/**
 * Checks one configuration against a service's normalized descriptor fields.
 * Pure: no lifecycle policy, no stored design.
 * @param {object} configuration field key → scalar
 * @param {object[]} fields normalized descriptor fields (capability-descriptors.service.js)
 * @returns {{ problems: object[], deprecations: object[] }}
 *   problems: `{ field, code, value }`; deprecations: `{ field, code, value, supersededBy }`
 */
export function checkServiceConfiguration(configuration, fields) {
    const problems = [];
    const deprecations = [];
    const fieldsByKey = new Map(fields.map(field => [field.key, field]));

    for (const [key, value] of Object.entries(configuration)) {
        const field = fieldsByKey.get(key);
        if (!field) {
            problems.push({ field: key, code: "unknown_field", value });
            continue;
        }
        if (isUnset(value)) {
            continue; // the service default applies; `required` is checked below
        }

        const code = typeProblem(field, value) ?? valueProblem(field, value);
        if (code) {
            problems.push({ field: key, code, value });
            continue;
        }

        if (field.status === "deprecated") {
            deprecations.push(deprecation(key, "deprecated_field", value, field.supersededBy));
        }
        const entry = field.type === "enum"
            ? field.validation.entries.find(candidate => candidate.value === value)
            : null;
        if (entry?.status === "deprecated") {
            deprecations.push(deprecation(key, "deprecated_value", value, entry.supersededBy));
        }
    }

    for (const field of fields) {
        if (field.required && isUnset(configuration[field.key])) {
            problems.push({ field: field.key, code: "required", value: null });
        }
    }

    return { problems, deprecations };
}


