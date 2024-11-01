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

export const getUserByEmail = async (email) => {
    const sqlParams = [pglib.param("plain", email)];
    const dbParams = {
        sql:       "SELECT * FROM users WHERE mail = $1",
        dbcon:     config.dbconnString,
        sqlParams: sqlParams,
    };

    try {
        const result = await pglib.execSQL(dbParams);
        return result;
    } catch (err) {
        console.error("Error querying user:", err);
        throw new Error("Failed to get user");
    }
};

export async function setPasswordResetToken(token, expires, email) {
    const sql = `
    UPDATE users 
    SET reset_password_token = $1, reset_password_expires = $2 
    WHERE mail = $3
    `;
    
    const sqlParams = [token, expires, email];
    
    try {
        await pglib.execSQL({
            sql: sql,
            dbcon: config.dbconnString,
            sqlParams: sqlParams
        }); 
    } catch(error) {
        log.error("Could not set password reset token");
        throw new Error(error);
    }
}

export async function updatePassword(token, email, newPassword) {
    const hashedPassword = await hashPassword(newPassword);

    const sql = `
        UPDATE users 
        SET pass = $1, reset_password_token = NULL, reset_password_expires = NULL 
        WHERE reset_password_token = $2 AND
        mail = $3
    `;
    const sqlParams = [hashedPassword, token, email];

    try {
        await pglib.execSQL({
            sql: sql,
            dbcon: config.dbconnString,
            sqlParams: sqlParams
        });

        return true;
    } catch (err) {
        console.error("Error updating password:", err);
        throw new Error("Error updating password.");
    }
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

export async function hasTheUserRole(email, role) {
    try {
        const sql = `
        SELECT role
        FROM users
        WHERE mail = $1 
        AND role = $2
        LIMIT 1
    `;
        const values = [email, role];

        // Get the database instance
        const db = await pglib.getDBInstance(config.dbconnString);
        const result = await db.query(sql, values);
        
        return result.rows.length > 0
  } catch(err) {
    const msg = "Could not get role for user.";
    console.error(msg);
    throw new Error(msg);
  }
}

// Hash password with bcrypt
export async function hashPassword(password) {
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
}

export async function validatePassword(password, passwordConfirmation) {
    return await bcrypt.compare(password, passwordConfirmation);    
}

export const insertNewUser = async (displayName, email) => {
    try {
        const saltRounds = 10; 
        const passwordHash = await bcrypt.hash(displayName, saltRounds);

        const sqlParams = [
            param("plain", displayName),
            param("plain", email),
            param("plain", passwordHash),
            param("plain", "11111111-1"),
            param("plain", "U"), // Undefined gender
            param("plain", "A"), // Student role
            param("verified_email", "TRUE") // Verification by OAuth2 provider
        ];

        const dbParams = {
            sql:       
                `INSERT INTO users (
                    name, mail, pass, rut, sex, role, verified_email) 
                    VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            dbcon:     config.dbconnString,
            sqlParams: sqlParams,
        };

        await pglib.execSQL(dbParams);
    } catch (err) {
        console.error("Error during user insertion:", err);
        throw new Error("Failed to insert new user");
    }
};
