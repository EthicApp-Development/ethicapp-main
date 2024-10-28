import * as config from "../config/config.js";
import * as pglib from "../db/rest-pg-2.js";
import bcrypt from "bcrypt";

export async function checkPendingRequestByEmail(email) {
    const sql = `
        SELECT 1
        FROM teacher_account_requests
        WHERE mail = $1 AND status = $2
        LIMIT 1
    `;
    const values = [email, "0"];

    try {
        // Get the database instance
        const db = await pglib.getDBInstance(config.dbconnString);
        const result = await db.query(sql, values);
        
        if (result.rows.length > 0) {
            console.debug(`Pending teacher account request found for email '${email}'`);
        }

        // Return true if at least one row meets the criteria, otherwise false
        return result.rows.length > 0;
    } catch (error) {
        console.error("Error checking pending request by email:", error);
        // Exception handling: return false as a safe case in error
        return false;
    }
}

// Check if the user or account request already exists
export async function checkIfUserExists(email, table = "users") {
    const dbParams = {
        sql:       `SELECT COUNT(*) FROM ${table} WHERE mail = $1`,
        dbcon:     config.dbconnString,
        sqlParams: [email]
    };
    const result = await pglib.execSQL(dbParams);
    return result[0].count > 0;
}

export async function isEmailVerified(email) {
    const sql = `
        SELECT 1
        FROM users
        WHERE mail = $1 AND verified_email = TRUE
        LIMIT 1
    `;
    const values = [email];

    // Get the database instance
    const db = await pglib.getDBInstance(config.dbconnString);
    const result = await db.query(sql, values);
    
    // Return true if at least one row meets the criteria, otherwise false
    return result.rows.length > 0;    
}

// Hash password with bcrypt
export async function hashPassword(password) {
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
}
