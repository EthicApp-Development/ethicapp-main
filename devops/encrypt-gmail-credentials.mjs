#!/usr/bin/env node

// Import the necessary modules
import crypto from "crypto";
import readline from "readline";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Check for the required environment variables
if (!process.env.CREDENTIALS_SECRET_KEY || !process.env.CREDENTIALS_IV) {
    console.error(
        'Error: CREDENTIALS_SECRET_KEY and CREDENTIALS_IV must be defined in the .env file. Run the "init-credentials" task first.');
    process.exit(1); // Abort the script with a non-zero exit code
}

// Define the encryption function
const encrypt = (text) => {
    const cipher = crypto.createCipheriv(
        "aes-256-cbc",
        Buffer.from(process.env.CREDENTIALS_SECRET_KEY, "hex"),
        Buffer.from(process.env.CREDENTIALS_IV, "hex")
    );
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    return encrypted;
};

// Function to prompt for user input, with hidden password for security
const promptUserInput = (query, hideInput = false) => {
    const rl = readline.createInterface({
        input:  process.stdin,
        output: process.stdout,
    });

    // If hideInput is true, disable output temporarily to hide password
    if (hideInput) rl.stdoutMuted = true;

    return new Promise((resolve) => {
        rl.question(query, (input) => {
            rl.close();
            resolve(input);
        });
        // If hideInput, use a listener to mute output
        rl._writeToOutput = (stringToWrite) => {
            if (rl.stdoutMuted) rl.output.write("*");
            else rl.output.write(stringToWrite);
        };
    });
};

// Main function to handle encryption process
const encryptCredentials = async () => {
    // Prompt the user for their Gmail username and password
    const gmailUser = await promptUserInput("Enter your Gmail username: ");
    const gmailPass = await promptUserInput("Enter your Gmail password: ", true);

    // Encrypt the user credentials
    const encryptedUser = encrypt(gmailUser);
    const encryptedPass = encrypt(gmailPass);

    // Output the encrypted credentials
    console.log("\nEncrypted credentials:");
    console.log("GMAIL_USER_ENCRYPTED:", encryptedUser);
    console.log("GMAIL_PASS_ENCRYPTED:", encryptedPass);
    console.log("Be sure to add these variables to your .env file.");
};

// Run the main function
encryptCredentials();
