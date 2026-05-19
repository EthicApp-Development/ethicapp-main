import { dbconnString } from "../config/database.config.js";
import { uploadsPath } from "../config/uploads.config.js";

export const pass = {
    dbcon: dbconnString,
    uploadsPath: uploadsPath
}

export default pass;
