import * as config from "../config/config.js"; 
import * as rpg2 from "../db/rest-pg-2.js";

/**
 * Fetches a design from the "designs" table by its ID.
 * @param {number} id - The ID of the design to fetch.
 * @returns {Promise<Object>} - A promise that resolves to the design object or null if not found.
 * @throws {Error} If there is an issue with the database query.
 */
export async function getDesignById(id) {
    try {
        // Execute the SQL query to fetch the design
        const result = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT id, design, creator, public, locked, case_id
                FROM designs
                WHERE id = $1
            `,
            sqlParams: [id],
        });

        // If no design is found, return null
        if (result.length === 0) {
            return null;
        }

        // Return the design (first row) as an object
        return result[0];
    } catch (error) {
        // Log and rethrow the error for handling by the caller
        console.error("Error fetching design by ID:", error);
        throw new Error("Unable to fetch design.");
    }
}
