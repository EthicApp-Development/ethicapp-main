
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import ejs from "ejs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sesClient = new SESClient({ region: "us-west-2" });

async function sendPasswordResetEmail(email, locale, subject, resetUrl) {
    const templatePath = path.join(__dirname, "templates", "locale", "reset-password.ejs");
    const htmlContent = await ejs.renderFile(templatePath, { resetUrl });

    const params = {
        Source:      "no-reply@ethicapp.info",
        Destination: {
            ToAddresses: [email],
        },
        Message: {
            Subject: {
                Data: subject,
            },
            Body: {
                Html: {
                    Data: htmlContent,
                },
            },
        },
    };

    try {
        const command = new SendEmailCommand(params);
        await sesClient.send(command);
        console.log("Email sent successfully.");
    } catch (err) {
        console.error("Error sending email: ", err);
        throw err;
    }
}

export default { sendPasswordResetEmail };
