// A stand-in for PostgreSQL in controller tests: it patches pg's Pool so that
// db/rest-pg-2.js and the controllers' transactions never open a connection.
// Every query is recorded, and `rowsFor(sql, params)` answers it. This file is
// a test helper, not a test: its name does not end in .node-test.mjs.
import express from "express";
import pg from "pg";

export function installFakePgPool(rowsFor) {
    const queries = [];
    const originalConnect = pg.Pool.prototype.connect;
    const originalQuery = pg.Pool.prototype.query;

    function query(sql, params) {
        const text = typeof sql === "string" ? sql : sql?.text;
        queries.push({ sql: text, params });
        return Promise.resolve({ rows: rowsFor(text, params) ?? [] });
    }

    pg.Pool.prototype.connect = async function connect() {
        return { query, release() {} };
    };
    pg.Pool.prototype.query = query;

    return {
        queries,
        reset() {
            queries.length = 0;
        },
        restore() {
            pg.Pool.prototype.connect = originalConnect;
            pg.Pool.prototype.query = originalQuery;
        },
    };
}

/**
 * Sends one JSON request to `router` (or to each router of an array, mounted
 * in order) in an app with a fixed session. A body that is not JSON comes
 * back as text.
 */
export async function requestRouter(router, {
    method = "GET",
    path,
    body,
    session = { uid: 7, role: "P" },
}) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.session = session;
        next();
    });
    for (const mounted of [router].flat()) {
        app.use(mounted);
    }

    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    try {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
            method,
            headers: { "Content-Type": "application/json" },
            body:    body === undefined ? undefined : JSON.stringify(body),
        });
        const isJson = response.headers.get("content-type")?.includes("application/json");
        const responseBody = isJson ? await response.json() : await response.text();
        return { status: response.status, body: responseBody };
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}
