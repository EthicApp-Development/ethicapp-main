// Reads an `INSERT INTO table (columns) VALUES (values)` statement and its
// parameters back as the row it would insert, `{ column: value }`, so tests
// can check a value by its column instead of by its parameter's position.
// Each value is a `$n` parameter, a `true`, `false` or `null` literal, a
// quoted string, or `COALESCE(...)` of those. This file is a test helper, not
// a test: its name does not end in .node-test.mjs.

function splitTopLevel(list) {
    const items = [];
    let depth = 0;
    let current = "";
    for (const character of list) {
        if (character === "," && depth === 0) {
            items.push(current.trim());
            current = "";
            continue;
        }
        if (character === "(") {
            depth += 1;
        } else if (character === ")") {
            depth -= 1;
        }
        current += character;
    }
    items.push(current.trim());
    return items;
}

function evaluate(expression, params) {
    const parameter = /^\$(\d+)$/u.exec(expression);
    if (parameter) {
        return params[Number(parameter[1]) - 1];
    }
    const literals = { true: true, false: false, null: null };
    if (expression.toLowerCase() in literals) {
        return literals[expression.toLowerCase()];
    }
    const quoted = /^'(.*)'$/u.exec(expression);
    if (quoted) {
        return quoted[1];
    }
    const coalesce = /^COALESCE\(([\s\S]*)\)$/iu.exec(expression);
    if (coalesce) {
        return splitTopLevel(coalesce[1])
            .map(argument => evaluate(argument, params))
            .find(value => value !== null && value !== undefined) ?? null;
    }
    throw new Error(`Unsupported value expression: ${expression}`);
}

export function insertedRow(sql, params) {
    const match = new RegExp(String.raw`INSERT INTO\s+\w+\s*\(([^)]*)\)\s*`
        + String.raw`VALUES\s*\(([\s\S]*)\)\s*(?:RETURNING[\s\S]*)?;?\s*$`, "u").exec(sql);
    if (!match) {
        throw new Error(`Not a single-row INSERT ... VALUES statement: ${sql}`);
    }
    const columns = splitTopLevel(match[1]);
    const values = splitTopLevel(match[2]);
    if (columns.length !== values.length) {
        throw new Error(`${columns.length} columns but ${values.length} values`);
    }
    return Object.fromEntries(columns.map((column, index) => [
        column,
        evaluate(values[index], params),
    ]));
}
