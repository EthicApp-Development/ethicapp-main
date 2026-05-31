import { pool } from "../config/database.js";
import {
    parseStudentAnonymizationOptions,
    runStudentAnonymization,
} from "../helpers/student-anonymization-helper.js";

async function main() {
    const options = parseStudentAnonymizationOptions(process.argv.slice(2), process.env);
    const result = await runStudentAnonymization({
        pool,
        options,
        logger: console,
    });

    if (result.failed > 0) {
        process.exitCode = 1;
    }
}

main()
    .catch((error) => {
        console.error(`[student-anonymization] fatal error: ${error.stack || error.message || error}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });
