import * as pglib from "../db/rest-pg-2.js";

export async function validateToken(token, dbcon) {
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
            sqlParams: sqlParams.map((param, index) => pglib.param("plain", `param${index}`))
        });

        if (users.length === 0) {
            throw new Error("Invalid or expired token.");
        }

        return users[0];
    } catch (err) {
        console.error("Error verifying reset token:", err);
        throw new Error("Error verifying reset token.");
    }
}