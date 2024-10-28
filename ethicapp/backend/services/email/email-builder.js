import ejs from "ejs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function buildEmail(locale, template, params) {
    console.debug(`locale: ${locale}`);
    console.debug(`template: ${template}`);
    const templatePath = path.join(__dirname, 
        "templates", locale, template);
    const htmlContent = await ejs.renderFile(templatePath, params);
    
    return htmlContent;
}