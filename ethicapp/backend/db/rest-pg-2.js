import pkg from "pg";
const { Pool } = pkg;

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
        // Optionally, release the client when done
        client.release(); // Releases the client to the pool
        return pool;
    } catch (err) {
        console.error("Error connecting to the database:", err);
        pool = null;
        throw err;
    }
}

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
 * Execute a single SQL statement with result handling.
 * @param {Object} params - Parameters including:
 *   - sql (required): String SQL query to be executed.
 *   - dbcon (required): String containing the database connection string.
 *   - sqlParams: (optional) Array of SQL statement parameters to be passed with the query.
 *   - onStart: (optional) Function to modify the SQL query or parameters just before execution.
 *   - onEnd: (optional) Function to be executed with the query result after execution.
 * @throws {Error} If there is a database query error or if required parameters are missing.
 * @return {Promise<Array>} - Resolves with the rows of the SQL query result.
 */
async function execSQL(params) {
    if (!params.sql || !params.dbcon) {
        throw new Error("Missing required parameters: 'sql' or 'dbcon'.");
    }

    const db = await getDBInstance(params.dbcon);
    let sql = params.sql;

    try {
        // Prepare SQL parameters
        const sqlParams = params.sqlParams ? smartArrayConvert(params.sqlParams) : [];

        // If an onStart function is provided, modify SQL before execution
        if (params.onStart) {
            sql = params.onStart() || params.sql;
        }

        const result = await db.query(sql, sqlParams);

        // If an onEnd callback is provided, execute it with the result
        if (params.onEnd) {
            params.onEnd(result.rows);
        }

        return result.rows;
    } catch (err) {
        console.error("[DB Error]:", err);
        throw new Error("Error executing SQL query.");
    }
}

/**
 * Execute a single SQL statement.
 * @param {Object} params - Parameters including:
 *   - sql (required): String SQL query to be executed.
 *   - dbcon (required): String containing the database connection string.
 *   - sqlParams: (optional) Array of SQL statement parameters to be passed with the query.
 *   - onSelect: (optional) Function to handle the first result row after the SQL query is executed. 
 *     It replaces the default return behavior.
 *   - onEnd: (optional) Function to be executed just after the SQL query result is obtained.
 *     Receives the final result as a parameter.
 * @throws {Error} If there is a database query error or if required parameters are missing.
 * @return {Promise<Object>} - Resolves with the final result of the SQL query.
 */
async function singleSQL(params) {
    if (!params.sql || !params.dbcon) {
        throw new Error("Missing required parameters: 'sql' or 'dbcon'.");
    }

    const db = await getDBInstance(params.dbcon);

    try {
        // Prepare SQL parameters
        const sqlParams = params.sqlParams ? smartArrayConvert(params.sqlParams) : [];
        const result = await db.query(params.sql, sqlParams);

        let finalResult = {};
        if (result.rows.length > 0) {
            if (params.onSelect) {
                finalResult = params.onSelect(result.rows[0]);
            } else {
                finalResult = result.rows[0];
            }
        }

        // If there is an onEnd callback, execute it with the result
        if (params.onEnd) {
            params.onEnd(finalResult);
        }

        return finalResult;
    } catch (err) {
        console.error("[DB Error]:", err);
        throw new Error("Error executing SQL query.");
    }
}

/**
 * Execute a select multiple SQL statement.
 * @param {Object} params - Parameters including:
 *   - sql (required): String SQL query to be executed.
 *   - dbcon (required): String containing the database connection string.
 *   - sesReqData: (optional) Array of session keys required for the query. If any are missing, an error is thrown.
 *   - postReqData: (optional) Array of request body keys required for the query. If any are missing, an error is thrown.
 *   - sqlParams: (optional) Array of SQL parameters to be passed with the query. The parameters can reference session data, request body data, or calculated data.
 *   - onStart: (optional) Function to be executed before the SQL query is executed. Receives session data, request body data, and a calculation object for passing data between functions.
 *   - onRow: (optional) Function to process each row of the query result. The function should return the transformed row or `null` to exclude the row from the final result.
 *   - onEnd: (optional) Function to be executed with the final result after all rows have been processed.
 * @throws {Error} If required parameters are missing or the query fails.
 * @return {Promise<Array>} - Resolves with the final processed result array.
 */
async function multiSQL(params) {
    if (!params.sql || !params.dbcon) {
        throw new Error("Missing required parameters: 'sql' or 'dbcon'.");
    }

    const db = await getDBInstance(params.dbcon);

    return async function executeMultiSQL(sessionData, bodyData = {}) {
        const calc = {};

        // Validate session-required data
        if (params.sesReqData) {
            params.sesReqData.forEach((key) => {
                if (!sessionData[key]) {
                    console.error(`[Req Error] Missing session data: ${key}`);
                    throw new Error(`Missing session data: ${key}`);
                }
            });
        }

        // Validate body-required data
        if (params.postReqData) {
            params.postReqData.forEach((key) => {
                if (!bodyData[key]) {
                    console.error(`[Req Error] Missing body data: ${key}`);
                    throw new Error(`Missing body data: ${key}`);
                }
            });
        }

        if (params.onStart) {
            params.onStart(sessionData, bodyData, calc);
        }

        try {
            const sqlParams = params.sqlParams ? smartArrayConvert(params.sqlParams, sessionData, bodyData, calc) : [];
            const result = await db.query(params.sql, sqlParams);
            const rows = result.rows;

            // Use map to process rows and optionally apply the onRow transformation
            const finalResult = rows.map(row => {
                return params.onRow ? params.onRow(row) : row;
            }).filter(row => row !== null); // Filter out any null rows if onRow returns null

            if (params.onEnd) {
                params.onEnd(finalResult);
            }

            return finalResult;
        } catch (err) {
            console.error("[DB Error]:", err);
            throw new Error("Error executing multiSQL query");
        }
    };
}


// Exports
export { smartArrayConvert, param, getDBInstance, execSQL, singleSQL, multiSQL };