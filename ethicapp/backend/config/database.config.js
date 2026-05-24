function encodeCredential(value) {
    return encodeURIComponent(String(value || ""));
}

function buildConnectionString() {
    if (process.env.DATABASE_URL) {
        return process.env.DATABASE_URL;
    }

    if (process.env.DB_CONNECTION_STRING) {
        return process.env.DB_CONNECTION_STRING;
    }

    const host = process.env.PGHOST || "localhost";
    const port = process.env.PGPORT || "5432";
    const user = process.env.PGUSER || "postgres";
    const password = process.env.PGPASSWORD || "";
    const database = process.env.PGDATABASE || process.env.POSTGRES_DB || "ethicapp";
    const sslMode = process.env.PGSSLMODE || "disable";
    const auth = password
        ? `${encodeCredential(user)}:${encodeCredential(password)}`
        : encodeCredential(user);
    const query = sslMode && sslMode !== "disable"
        ? `?sslmode=${encodeURIComponent(sslMode)}`
        : "";

    return `postgres://${auth}@${host}:${port}/${database}${query}`;
}

const dbconnString = buildConnectionString();

export { dbconnString };
