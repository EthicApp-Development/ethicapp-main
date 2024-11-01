"use strict";
import * as config from "../../config/config.js";
import { param, execSQL } from  "../../db/rest-pg-2.js";

export async function userLogin() {
    try {
        const sqlParams = [0];
        const dbParams = {
            sql:       "SELECT UpdateOrInsertLoginRecord($1)",
            dbcon:     config.dbconnString,
            sqlParams: sqlParams
        };
        await execSQL(dbParams);
    }
    catch(error) {
        throw new Error("Could not record the user login event in the database.");
    }    
}