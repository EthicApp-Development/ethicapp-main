import * as crypto from "crypto";
import * as pglib from "../db/rest-pg-2.js";

export async function validatePasswordResetToken(token, dbcon) {
    const sql = `
        SELECT * FROM users 
        WHERE reset_password_token = $1 
        AND reset_password_expires > NOW()
    `;
    const sqlParams = [token];

    try {
        const users = await pglib.execSQL({
            sql,
            dbcon,
            sqlParams: sqlParams
        });

        if (users.length === 0) {
            throw new Error("Invalid or expired token.");
        }

        return users[0];
    } catch (err) {
        const errorMessage = "Error verifying reset token";
        console.error(errorMessage, err);
        throw new Error(errorMessage);
    }
}

export async function validateEmailVerificationToken(table, token, dbcon) {
    const sql = `
        SELECT * FROM $1 
        WHERE validate_email_token = $2 
        AND validate_email_expires > NOW()
    `;
    const sqlParams = [table, token];

    try {
        const users = await pglib.execSQL({
            sql,
            dbcon,
            sqlParams: sqlParams
        });

        if (users.length === 0) {
            throw new Error("Invalid or expired token.");
        }

        return users[0];
    } catch (err) {
        const errorMessage = "Error validating email verification token";
        console.error(errorMessage, err);
        throw new Error(errorMessage);
    }
}

export function generateToken() {
    const token = crypto.randomBytes(20).toString("hex");
    const expires = new Date(Date.now() + 3600000 * 24);
    return { token: token, expires: expires };
}