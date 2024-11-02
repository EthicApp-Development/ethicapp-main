import express from "express";
import pass from "../helpers/compat-helper.js"
import * as rpg from "../db/rest-pg.js";
import Redis from "ioredis";
import { DateTime } from "luxon";

let router = express.Router();

const redisClient = new Redis({
    host: "redis", // Redis server host
    port: 6379,    // Redis server port
});

router.get("/report", async (req, res) => {
    await rpg.multiSQL({
        dbcon: pass.dbcon,
        sql:   `
        SELECT *
        FROM report_type;
        `,
        onEnd: (req, res, results) => {
            var reportDescriptions = [];
            var reportTypes = [];

            results.forEach(element => {
                reportDescriptions.push(element["report_description"]);
                reportTypes.push(element["report_type"]);
            });

            res.status(200).json({
                reports:     reportTypes,
                description: reportDescriptions
            });
        }
    })(req,res);
});

router.get("/report/:type", await rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: `
        SELECT *
        FROM report_type
        WHERE report_type = $1
    `,
    sqlParams: [rpg.param("params", "type")],
    onEnd: (req, res, results) => {
        res.status(200).json(results);
    },
    onError: (err, req, res) => {
        console.error("Error in /report/:type query:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
}));


router.get("/institution", async (req, res) => {
    await rpg.multiSQL({
        dbcon: pass.dbcon,
        sql:   `
        SELECT *
        FROM institution;
        `,
        onEnd: (req, res, results) => {
            res.status(200).json(results[0]);
        }
    })(req,res);
});

router.put("/institution", await rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: `
        UPDATE institution
        SET
            institution_name = $1,
            institution_url = $2,
            ethicapp_url = $3,
            physical_address = $4,
            institution_logo = $5,
            institution_it_email = $6,
            institution_educational_email = $7
    `,
    sqlParams: [
        rpg.param("body", "institution_name"),
        rpg.param("body", "institution_url"),
        rpg.param("body", "ethicapp_url"),
        rpg.param("body", "physical_address"),
        rpg.param("body", "institution_logo"),
        rpg.param("body", "institution_it_email"),
        rpg.param("body", "institution_educational_email")
    ],
    onEnd: (req, res) => {
        res.status(200).json({ status: "ok" });
    },
    onError: (err, req, res) => {
        console.error("Error in /institution update:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
}));

router.post("/report/:type", async (req, res) => {
    const { type } = req.params;
    const { initialDate, endDate } = req.body;

    const cacheKey = `${type}/${initialDate}/${endDate}`;
    const cachedData = await redisClient.get(cacheKey);
    const cacheTTL = 24 * 60 * 60; // 24 hours in seconds

    if (cachedData !== null) {
        console.log("Cache Passing");
        const parsedData = JSON.parse(cachedData);
        return res.status(200).json(parsedData);
    } else {
        const date1 = new Date(initialDate);
        const date2 = new Date(endDate);
        const differenceInMilliseconds = date2 - date1;
        const millisecondsInMonth = 30.44 * 24 * 60 * 60 * 1000;
        const differenceInMonths = differenceInMilliseconds / millisecondsInMonth;

        let sqlQuery;
        let sqlParams = [initialDate, endDate];

        switch (type) {
            case "start_activity":
                sqlQuery = differenceInMonths > 1
                    ? `
                        SELECT TO_CHAR(creation_date, 'YYYY-MM') AS date, SUM(count) AS count
                        FROM report_activity
                        WHERE creation_date >= $1 AND creation_date <= $2
                        GROUP BY date
                        ORDER BY date;
                    `
                    : `
                        SELECT TO_CHAR(creation_date, 'YY-MM-DD') AS date, SUM(count) AS count
                        FROM report_activity
                        WHERE creation_date >= $1 AND creation_date <= $2
                        GROUP BY creation_date
                        ORDER BY creation_date;
                    `;
                break;

            case "create_account":
                sqlQuery = differenceInMonths > 1
                    ? `
                        SELECT TO_CHAR(creation_date, 'YYYY-MM') AS date, 
                               SUM(count) AS count, is_teacher
                        FROM report_create_account
                        WHERE creation_date >= $1 AND creation_date <= $2
                        GROUP BY date, is_teacher
                        ORDER BY date;
                    `
                    : `
                        SELECT TO_CHAR(creation_date, 'YY-MM-DD') AS date, count AS count, is_teacher
                        FROM report_create_account
                        WHERE creation_date >= $1 AND creation_date <= $2
                        ORDER BY creation_date;
                    `;
                break;

            case "logins":
                sqlQuery = differenceInMonths > 1
                    ? `
                        SELECT TO_CHAR(login_date, 'YYYY-MM') AS date, SUM(count) AS count, is_teacher
                        FROM report_login
                        WHERE login_date >= $1 AND login_date <= $2
                        GROUP BY date, is_teacher
                        ORDER BY date;
                    `
                    : `
                        SELECT TO_CHAR(login_date, 'YY-MM-DD') AS date, count AS count, is_teacher
                        FROM report_login
                        WHERE login_date >= $1 AND login_date <= $2
                        ORDER BY login_date;
                    `;
                break;

            case "top_professors":
                sqlQuery = `
                    SELECT users.name AS date, SUM(count) AS count
                    FROM report_activity
                    JOIN users ON users.id = report_activity.professor
                    WHERE creation_date >= $1 AND creation_date <= $2
                    GROUP BY users.name
                    ORDER BY count DESC
                    LIMIT 10;
                `;
                break;

            default:
                return res.status(400).json({ error: "Invalid report type" });
        }

        await rpg.multiSQL({
            dbcon: pass.dbcon,
            sql: sqlQuery,
            sqlParams: sqlParams,
            onEnd: (req, res, results) => {
                const x_data = [];
                const y1_data = [];
                const y2_data = [];

                results.forEach(element => {
                    x_data.push(element["date"]);
                    if (type === "create_account" || type === "logins") {
                        if (element["is_teacher"] === "0") {
                            y1_data.push(parseInt(element["count"], 10));
                        } else {
                            y2_data.push(parseInt(element["count"], 10));
                        }
                    } else {
                        y1_data.push(parseInt(element["count"], 10));
                    }
                });

                const json_query = {
                    report_title: `${type} : ${initialDate} - ${endDate}`,
                    report_x_data: x_data,
                    report_y1_data: y1_data,
                    report_y2_data: y2_data,
                    report_type: type,
                    creation_date: CurrentDate()
                };

                redisClient.setex(cacheKey, cacheTTL, JSON.stringify(json_query));

                return res.status(200).json(json_query);
            },
            onError: (err, req, res) => {
                console.error("Error in /report/:type query:", err);
                res.status(500).json({ error: "Internal Server Error" });
            }
        })(req, res);
    }
});

router.post("/upload-file-institution", (req, res) => {
    if (req.files.file != null && req.files.file.mimetype == "image/png") {
        res.status(200).json({ message: "File uploaded", filename: req.files.file.file });
    } else {
        res.status(400).json({ message: "No file uploaded" });
    }
});

function CurrentDate() {
    const now = DateTime.now().setZone("America/Santiago");
    return now.toFormat("dd-MM-yyyy HH:mm:ss");
}

export default router;
