import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";

async function main() {
    const db = await rpg2.getDBInstance(config.dbconnString);
    const result = await db.query(`
        UPDATE ethical_cases_authors AS ca
        SET user_id = u.id,
            updated_at = NOW()
        FROM ethical_case_author AS a
        INNER JOIN users AS u
            ON LOWER(u.mail) = LOWER(a.author_email)
        WHERE ca.author_id = a.id
          AND ca.user_id IS NULL
        RETURNING ca.case_id, ca.author_id, ca.user_id;
    `);

    console.info(`Linked ${result.rowCount} ethical case author records to EthicApp users.`);
    await db.end();
}

main().catch(async (error) => {
    console.error("Unable to link ethical case authors to users.", error);
    process.exitCode = 1;
});
