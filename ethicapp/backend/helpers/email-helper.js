import { buildEmail } from "../services/email/email-builder.js";
import { sendEmail } from "../services/email/email-sender.js";

export async function sendEthicAppEmail(locale, email, subject, 
    template, params = {}) {
    const emailText = await buildEmail(locale, template, params);
    const attachments = [{
        filename: "ethicapp-logo-email.png",
        cid:      "ethicappLogo"
    }];

    await sendEmail(email, subject, emailText, attachments);
}
