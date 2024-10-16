// Import the `pg` module using `import` (modern JS)
import pkg from "pg";
const { Client } = pkg;

// Declare `DB` as `let` to allow reassignment
let DB = null;

// Use `const` for variables that will not be reassigned
function smartArrayConvert(sqlParams, ses, data, calc) {
    const arr = [];
    for (let i = 0; i < sqlParams.length; i++) {
        let p = sqlParams[i];
        p = JSON.parse(p);
        if (p.type === "plain")
            arr.push(p.name);
        else if (p.type === "ses")
            arr.push(ses[p.name]);
        else if (p.type === "calc")
            arr.push(calc[p.name]);
        else
            arr.push(data[p.name]);
    }
    return arr;
}

// Convert `getDBInstance` to an asynchronous function
async function getDBInstance(dbcon) {
    if (DB === null) {
        DB = new Client(dbcon);
        try {
            await DB.connect();
            // Handle the `error` event
            DB.on("error", (err) => {
                console.error(err);
                DB = null;
            });
        } catch (err) {
            console.error("Error connecting to the database:", err);
            DB = null;
        }
    }
    return DB;
}

/**
 * Returns a SQL statement parameter
 * @param {string} t - type of parameter (plain, post, or ses)
 * @param {string} n - name of the parameter
 * @return {string} - JSON string representing the parameter
 */
function param(t, n) {
    return JSON.stringify({ name: n, type: t });
}

/**
 * Returns a list of SQL statement parameters of the same type
 * @param {string} t - type of parameters
 * @param {Array<string>} arr - list of parameter names
 * @return {Array<string>} - list of JSON strings representing the parameters
 */
function paramsOfType(t, arr) {
    return arr.map(p => param(t, p));
}

/**
 * Execute a single SQL statement with ok / err response.
 * @param {Object} params - Parameters including:
 *   - sql (required): String SQL to be executed.
 *   - dbcon (required): String of database connection.
 *   - sesReqData: List of session required data.
 *   - postReqData: List of post request required data.
 *   - sqlParams: List of SQL statement parameters.
 *   - onStart: Function to be executed just before SQL execution.
 *   - onEnd: Function to be executed just before sending the end result.
 * @return {Function} - Express middleware function to execute the SQL statement.
 */
function execSQL(params) {
    if (!params.sql || !params.dbcon) {
        return null;
    }

    return async function (req, res) {
        const ses = req.session;

        if (params.sesReqData) {
            for (let i = 0; i < params.sesReqData.length; i++) {
                if (!ses[params.sesReqData[i]]) {
                    console.error(`[Req Error] Missing session data: ${params.sesReqData[i]}`);
                    res.status(400).json({ status: "err" });
                    return;
                }
            }
        }

        const data = req.body;
        const calc = {};

        if (params.postReqData) {
            for (let i = 0; i < params.postReqData.length; i++) {
                if (!data[params.postReqData[i]]) {
                    console.error(`[Req Error] Missing body data: ${params.postReqData[i]}`);
                    res.status(400).json({ status: "err" });
                    return;
                }
            }
        }

        const db = await getDBInstance(params.dbcon);
        let sql = params.sql;

        if (params.onStart) {
            sql = params.onStart(ses, data, calc) || params.sql;
        }

        try {
            const sqlParams = params.sqlParams ? smartArrayConvert(params.sqlParams, ses, data, calc) : [];
            const result = await db.query(sql, sqlParams);

            if (params.onEnd) {
                params.onEnd(req, res);
            } else {
                res.json({ status: "ok", result: result.rows });
            }

            if (!params.preventResEnd) {
                res.end();
            }
        } catch (err) {
            console.error("[DB Error]:", err);
            res.status(500).json({ status: "err" });
        }
    };
}

/**
 * Execute multiple SQL statements with ok / err response at the end of all.
 * @param {Object} params - Parameters including:
 *   - nsql (required): List of SQL strings to be executed.
 *   - dbcon (required): String of database connection.
 *   - sesReqData: List of session required data.
 *   - postReqData: List of post request required data.
 *   - nsqlParams: List of lists of SQL statement parameters.
 *   - onStart: Function to be executed just before SQL execution.
 *   - onEnd: Function to be executed just before sending the end result.
 * @return {Function} - Express middleware function to execute the SQL statements.
 */
function nExecSQL(params) {
    if (!params.nsql || !params.dbcon) {
        return null;
    }

    return async function (req, res) {
        const ses = req.session;
        const total = params.nsql.length;
        let completed = 0;

        if (params.sesReqData) {
            for (let i = 0; i < params.sesReqData.length; i++) {
                if (!ses[params.sesReqData[i]]) {
                    console.error(`[Req Error] Missing session data: ${params.sesReqData[i]}`);
                    res.status(400).json({ status: "err" });
                    return;
                }
            }
        }

        const data = req.body;
        const calc = {};

        if (params.postReqData) {
            for (let i = 0; i < params.postReqData.length; i++) {
                if (!data[params.postReqData[i]]) {
                    console.error(`[Req Error] Missing body data: ${params.postReqData[i]}`);
                    res.status(400).json({ status: "err" });
                    return;
                }
            }
        }

        const db = await getDBInstance(params.dbcon);

        for (let i = 0; i < total; i++) {
            let sql = params.nsql[i];

            if (params.onStart) {
                sql = params.onStart(ses, data, calc, i) || params.nsql[i];
            }

            try {
                const sqlParams = params.nsqlParams && params.nsqlParams[i] ? smartArrayConvert(params.nsqlParams[i], ses, data, calc) : [];
                await db.query(sql, sqlParams);
                completed++;

                if (completed >= total) {
                    if (params.onEnd) {
                        params.onEnd(req, res);
                    } else {
                        res.json({ status: "ok" });
                    }
                    res.end();
                }
            } catch (err) {
                console.error("[DB Error]:", err);
                res.status(500).json({ status: "err" });
                return;
            }
        }
    };
}

/**
 * Execute a select single SQL statement.
 * @param {Object} params - Parameters including:
 *   - sql (required): String SQL to be executed.
 *   - dbcon (required): String of database connection.
 *   - sesReqData: List of session required data.
 *   - postReqData: List of post request required data.
 *   - sqlParams: List of SQL statement parameters.
 *   - onStart: Function to be executed just before SQL execution.
 *   - onEnd: Function to be executed just before sending the end result.
 *   - onSelect: Function handled after SQL statement is executed. It replaces the normal return behavior.
 * @return {Function} - Express middleware function to execute the SQL statement.
 */
function singleSQL(params) {
    if (!params.sql || !params.dbcon) {
        return null;
    }

    return async function (req, res) {
        const ses = req.session;
        res.header("Content-type", "application/json");

        if (params.sesReqData) {
            for (let i = 0; i < params.sesReqData.length; i++) {
                if (!ses[params.sesReqData[i]]) {
                    console.error(`[Req Error] Missing session data: ${params.sesReqData[i]}`);
                    res.status(400).json({ status: "err" });
                    return;
                }
            }
        }

        const data = req.body;
        const calc = {};

        if (params.postReqData) {
            for (let i = 0; i < params.postReqData.length; i++) {
                if (!data[params.postReqData[i]]) {
                    console.error(`[Req Error] Missing body data: ${params.postReqData[i]}`);
                    res.status(400).json({ status: "err" });
                    return;
                }
            }
        }

        const db = await getDBInstance(params.dbcon);

        if (params.onStart) {
            params.onStart(ses, data, calc);
        }

        let sql = params.sql;
        try {
            const sqlParams = params.sqlParams ? smartArrayConvert(params.sqlParams, ses, data, calc) : [];
            const result = await db.query(sql, sqlParams);

            let finalResult = {};
            if (result.rows.length > 0) {
                if (params.onSelect) {
                    finalResult = params.onSelect(result.rows[0]);
                } else {
                    finalResult = result.rows[0];
                }
            }

            if (params.onEnd) {
                params.onEnd(req, res, finalResult);
            } else {
                finalResult["status"] = "ok";
                res.json(finalResult);
            }

            if (!params.preventResEnd) {
                res.end();
            }
        } catch (err) {
            console.error("[DB Error]:", err);
            res.status(500).json({ status: "err" });
        }
    };
}

/**
 * Execute a select multiple SQL statement.
 * @param {Object} params - Parameters including:
 *   - sql (required): String SQL to be executed.
 *   - dbcon (required): String of database connection.
 *   - sesReqData: List of session required data.
 *   - postReqData: List of post request required data.
 *   - sqlParams: List of SQL statement parameters.
 *   - onStart: Function to be executed just before SQL execution.
 *   - onEnd: Function to be executed just before sending the end result.
 *   - onRow: Function handled every fetched row. It replaces the normal row behavior.
 * @return {Function} - Express middleware function to execute the SQL statement.
 */
function multiSQL(params) {
    if (!params.sql || !params.dbcon) {
        return null;
    }

    return async function (req, res) {
        const ses = req.session;
        res.header("Content-type", "application/json");

        if (params.sesReqData) {
            for (let i = 0; i < params.sesReqData.length; i++) {
                if (!ses[params.sesReqData[i]]) {
                    console.error(`[Req Error] Missing session data: ${params.sesReqData[i]}`);
                    res.status(400).json([]);
                    return;
                }
            }
        }

        const data = req.body;
        const calc = {};

        if (params.postReqData) {
            for (let i = 0; i < params.postReqData.length; i++) {
                if (!data[params.postReqData[i]]) {
                    console.error(`[Req Error] Missing body data: ${params.postReqData[i]}`);
                    res.status(400).json([]);
                    return;
                }
            }
        }

        const db = await getDBInstance(params.dbcon);

        if (params.onStart) {
            params.onStart(ses, data, calc);
        }

        let sql = params.sql;
        try {
            const sqlParams = params.sqlParams ? smartArrayConvert(params.sqlParams, ses, data, calc) : [];
            const result = await db.query(sql, sqlParams);
            const rows = result.rows;

            const finalResult = [];
            for (const row of rows) {
                if (params.onRow) {
                    const transformedRow = params.onRow(row);
                    if (transformedRow != null) finalResult.push(transformedRow);
                } else {
                    finalResult.push(row);
                }
            }

            if (params.onEnd) {
                params.onEnd(req, res, finalResult);
            } else {
                res.json(finalResult);
            }

            if (!params.preventResEnd) {
                res.end();
            }
        } catch (err) {
            console.error("[DB Error]:", err);
            res.status(500).json([]);
        }
    };
}

// Exports
export { smartArrayConvert, param, getDBInstance, execSQL, nExecSQL, singleSQL, multiSQL };