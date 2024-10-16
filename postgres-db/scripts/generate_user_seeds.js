// Import required modules
import bcrypt from "bcrypt";
import fs from "fs";
import readline from "readline";
import { fileURLToPath } from "url";
import { dirname } from "path";

// Load user seed data from external JSON file
const users = JSON.parse(fs.readFileSync("seed_users.json", "utf8"));

// Generate SQL script to insert users with hashed passwords
async function generateSqlScript() {
    let sqlOutput = "";

    try {
        for (const user of users) {
            // Hash the user's password with bcrypt
            const hashedPassword = await bcrypt.hash(user.password, 10);

            // Generate SQL insert statement
            const query = `
INSERT INTO users (name, rut, pass, mail, sex, role, aprendizaje)
VALUES ('${user.name}', '${user.rut}', '${hashedPassword}', '${user.mail}', ${user.sex === null ? "NULL" : `'${user.sex}'`}, '${user.role}', ${user.aprendizaje === null ? "NULL" : `'${user.aprendizaje}'`});
`;
            sqlOutput += query;
        }

        const outputPath = "../seeds/development/01_users.sql";

        // Check if the file already exists
        if (fs.existsSync(outputPath)) {
            const rl = readline.createInterface({
                input:  process.stdin,
                output: process.stdout
            });

            rl.question("The file already exists. Do you want to overwrite it? (Y/n) ", (answer) => {
                if (answer.toLowerCase() === "y" || answer === "") {
                    fs.writeFileSync(outputPath, sqlOutput);
                    console.log(`SQL script generated successfully: ${outputPath}`);
                } else {
                    console.log("Operation cancelled by the user.");
                }
                rl.close();
            });
        } else {
            fs.writeFileSync(outputPath, sqlOutput);
            console.log(`SQL script generated successfully: ${outputPath}`);
        }
    } catch (err) {
        console.error("Error generating SQL script:", err);
    }
}

// Run the generateSqlScript function if executed as a script
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
if (process.argv[1] === __filename) {
    generateSqlScript();
}
