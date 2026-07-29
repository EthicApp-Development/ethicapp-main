const UTF8_BOM = "\uFEFF";

function csvEscape(value) {
    if (value === undefined || value === null) {
        return "\"\"";
    }

    const serializedValue = value instanceof Date
        ? value.toISOString()
        : String(value);
    return `"${serializedValue.replaceAll("\"", "\"\"")}"`;
}

export function buildCsv(columns, rows) {
    const lines = [
        columns.map(csvEscape).join(","),
        ...rows.map(row => columns.map(column => csvEscape(row[column])).join(",")),
    ];

    return `${UTF8_BOM}${lines.join("\n")}\n`;
}
