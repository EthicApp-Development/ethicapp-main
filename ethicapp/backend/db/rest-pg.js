import pg from "pg";
const { Pool } = pg;

// Declare `pool` globally
let pool = null;

async function getDBInstance(dbcon) {
    if (pool === null) {
        pool = new Pool({
            connectionString: dbcon
        });
        // Handle pool errors
        pool.on("error", (err) => {
            console.error("Unexpected error on idle client", err);
            process.exit(-1);
        });
    }
    try {
        const client = await pool.connect();
        client.release(); // Releases the client to the pool
        return pool;
    } catch (err) {
        console.error("Error connecting to the database:", err);
        pool = null;
        throw err;
    }
}

function smartArrayConvert(sqlParams, ses, data, calc) {
    const arr = [];
    for (let i = 0; i < sqlParams.length; i++) {
        let p = sqlParams[i];
        p = JSON.parse(p);

        let value;
        if (p.type === "plain") {
            value = p.name;
        } else if (p.type === "ses") {
            value = ses[p.name];
        } else if (p.type === "calc") {
            value = calc[p.name];
        } else {
            value = data[p.name];
        }

        //console.log(`Converted parameter: ${p.name} =`, value);
        arr.push(value);
    }
    return arr;
}

/**
 * Returns a sql statement parameter
 * @param t type of parameter (plain, post or ses)
 * @param n name of the parameter.
 */
export function param(t, n) {
    return JSON.stringify({name: n, type: t});
}


/**
 * Returns a list of sql statement parameters of the same type
 * @param {String} t - type of parameters
 * @param {Array<String>} arr - list of parameters names
 * @return {Array<SqlParam>}
 */
export function paramsOfType(t, arr) {
    return arr.map(p => module.exports.param(t,p));
}


/**
 * Execute a single sql statement with ok / err response.
 * @param params Parameters including:
 * <li> sql (required): String sql to be executed.
 * <li> dbcon (required): String of database connection.
 * <li> sesReqData: List of session required data.
 * <li> postReqData: List of post request required data.
 * <li> sqlParams: List of sql statement $ parameters.
 * <li> onStart: Function to be executed just before sql execution.
 * <li> onEnd: Function to be executed just before send end result.
 */
export function execSQL(params) {
    if (!params.sql || !params.dbcon) return null;

    return async function (req, res) {
        try {
            const ses = req.session;
            const data = req.body;
            const calc = {};

            if (params.sesReqData) {
                for (const reqData of params.sesReqData) {
                    if (ses[reqData] === undefined) {
                        console.error(`[execSQL, Req Error] Session parameter is missing: ${req.path} ${reqData}`);
                        res.status(400).json({ status: "err" });
                        return;
                    }
                }
            }

            if (params.postReqData) {
                for (const reqData of params.postReqData) {
                    if (data[reqData] === undefined) {
                        console.error(`[execSQL, Req Error] Body parameter is missing: ${req.path} ${reqData}`);
                        res.status(400).json({ status: "err" });
                        return;
                    }
                }
            }

            const pool = await getDBInstance(params.dbcon);
            const sql = params.onStart ? params.onStart(ses, data, calc) || params.sql : params.sql;
            const sqlParams = params.sqlParams ? smartArrayConvert(params.sqlParams, ses, data, calc) : [];

            const result = await pool.query(sql, sqlParams);
            const rows = result.rows.map(row => (params.onRow ? params.onRow(row) : row));

            if (params.onEnd) {
                params.onEnd(req, res, rows);
            } else {
                res.json({ status: "ok", data: rows });
            }
        } catch (err) {
            console.error("[DB Error]: ", err);
            res.status(500).json({ status: "err" });
        }
    };
}

/**
 * Execute a n sql statements with ok / err response at the end of all.
 * @param params Parameters including:
 * <li> nsql (required): List of String sql to be executed.
 * <li> dbcon (required): String of database connection.
 * <li> sesReqData: List of session required data.
 * <li> postReqData: List of post request required data.
 * <li> nsqlParams: List of List of sql statement $ parameters.
 * <li> onStart: Function to be executed just before sql execution.
 * <li> onEnd: Function to be executed just before send end result.
 */
export function nExecSQL(params) {
    if (!params.nsql || !params.dbcon) return null;

    return async function (req, res) {
        try {
            const ses = req.session;
            const data = req.body;
            const calc = {};

            if (params.sesReqData) {
                for (const reqData of params.sesReqData) {
                    if (!ses[reqData]) {
                        console.error("[nExecSQL, Req Error] Session parameter is missing: " + reqData);
                        res.status(400).json({ status: "err" });
                        return;
                    }
                }
            }

            if (params.postReqData) {
                for (const reqData of params.postReqData) {
                    if (!data[reqData]) {
                        console.error("[nExecSQL, Req Error] Body parameter is missing: " + reqData);
                        res.status(400).json({ status: "err" });
                        return;
                    }
                }
            }

            const pool = await getDBInstance(params.dbcon);

            const queries = params.nsql.map((sql, i) => {
                const currentSQL = params.onStart ? params.onStart(ses, data, calc, i) || sql : sql;
                const sqlParams = params.nsqlParams && params.nsqlParams[i] 
                    ? smartArrayConvert(params.nsqlParams[i], ses, data, calc) 
                    : [];
                return pool.query(currentSQL, sqlParams);
            });

            await Promise.all(queries);

            if (params.onEnd) {
                params.onEnd(req, res);
            } else {
                res.json({ status: "ok" });
            }
        } catch (err) {
            console.error("[DB Error]: ", err);
            res.status(500).json({ status: "err" });
        }
    };
}

/**
 * Execute a select single sql statement.
 * @param params Parameters including:
 * <li> sql (required): String sql to be executed.
 * <li> dbcon (required): String of database connection.
 * <li> sesReqData: List of session required data.
 * <li> postReqData: List of post request required data.
 * <li> sqlParams: List of sql statement $ parameters.
 * <li> onStart: Function to be executed just before sql execution.
 * <li> onEnd: Function to be executed just before send end result.
 * <li> onSelect: Function handled after sql statement is executed. It replaces the normal return
 * behavior.
 */
export function singleSQL(params) {
    if (!params.sql || !params.dbcon) return null; // Return null if essential parameters are missing
    return async function (req, res) {
        try {
            const ses = req.session; // Session object
            const data = req.body;   // Request body data
            const calc = {};         // Placeholder object for additional calculations
            res.header("Content-type", "application/json");

            // Validate required session data
            if (params.sesReqData) {
                for (const reqData of params.sesReqData) {
                    if (ses[reqData] === undefined) {
                        console.error(`[singleSQL, Req Error] Session parameter is missing: ${req.path} ${reqData}`);
                        res.status(400).json({ status: "err" });
                        return;
                    }
                }
            }

            // Validate body parameters
            if (params.postReqData) {
                for (const reqData of params.postReqData) {
                    if (data[reqData] === undefined) {
                        console.error(`[singleSQL, Req Error] Body is missing: ${req.path} ${reqData}`);
                        res.status(400).json({ status: "err" });
                        return;
                    }
                }
            }

            const pool = await getDBInstance(params.dbcon); // Retrieve the database pool

            // Execute onStart if defined, potentially modifying SQL or parameters
            if (params.onStart) params.onStart(ses, data, calc);

            // Set up SQL query and parameters
            const sqlParams = params.sqlParams ? smartArrayConvert(params.sqlParams, ses, data, calc) : [];
            const result = await pool.query(params.sql, sqlParams);

            // Process the result row (if any), using onSelect if provided
            const row = result.rows[0] || {};
            const processedRow = params.onSelect ? params.onSelect(row) : row;

            // Send final response or execute onEnd callback if defined
            if (params.onEnd) {
                params.onEnd(req, res, processedRow);
            } else {
                res.json({ ...processedRow, status: "ok" });
            }
        } catch (err) {
            // Handle any errors from the database or logic
            console.error("[DB Error]: ", err);
            res.status(500).json({ status: "err" });
        }
    };
}

/**
 * Execute a select multiple sql statement.
 * @param params Parameters including:
 * <li> sql (required): String sql to be executed.
 * <li> dbcon (required): String of database connection.
 * <li> sesReqData: List of session required data.
 * <li> postReqData: List of post request required data.
 * <li> sqlParams: List of sql statement $ parameters.
 * <li> onStart: Function to be executed just before sql execution.
 * <li> onEnd: Function to be executed just before send end result.
 * <li> onRow: Function handled every fetched row. It replaces the normal row behavior.
 */
export function multiSQL(params) {
    return async function (req, res) {
        try {
            const pool = await getDBInstance(params.dbcon);

            const ses = req.session;
            if (params.sesReqData) {
                for (const reqData of params.sesReqData) {
                    if (!ses[reqData]) {
                        console.error(`[multiSQL, Req Error] Missing session parameter: ${req.path} ${reqData}`);
                        res.status(400).json({ status: "err" });
                        return;
                    }
                }
            }

            const data = req.body;
            if (params.postReqData) {
                for (const reqData of params.postReqData) {
                    if (!data[reqData]) {
                        console.error(`[multiSQL, Req Error] Missing body parameter: ${req.path} ${reqData}`);
                        res.status(400).json({ status: "err" });
                        return;
                    }
                }
            }
            let calc = {};
            const sql = params.onStart ? params.onStart(ses, data, calc) || params.sql : params.sql;
            const sqlParams = params.sqlParams ? smartArrayConvert(params.sqlParams, ses, data, calc
            ) : [];
            const result = await pool.query(sql, sqlParams);

            const rows = result.rows.map(row => (params.onRow ? params.onRow(row) : row));
            res.json(rows);
        } catch (err) {
            console.error("[DB Error]: ", err);
            res.status(500).json({ status: "err" });
        }
    };
}
