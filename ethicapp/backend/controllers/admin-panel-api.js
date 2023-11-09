let express = require("express");
let Redis = require("ioredis");
let router = express.Router();
const { DateTime } = require("luxon");
let rpg = require("../db/rest-pg");
let pass = require("../config/keys-n-secrets");

const redisClient = new Redis({
    host: "RedisContainer", // Redis server host
    port: 6379,       // Redis server port
});

router.get("/report", async (req, res) => {
    rpg.multiSQL({
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

router.get("/report/:type", async (req, res) => {
    const { type } = req.params;
    rpg.multiSQL({
        dbcon: pass.dbcon,
        sql:   `
        SELECT *
        FROM report_type
        WHERE report_type='${type}';
        `,
        onEnd: (req, res, results) => {
            res.status(200).json(results);
        }
    })(req,res);
});

router.get("/institution", async (req, res) => {
    rpg.multiSQL({
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

router.put("/institution", async (req, res) => {
    const { institution_name, institution_url, ethicapp_url, physical_address, institution_logo, 
        institution_it_email, institution_educational_email } = req.body;

    rpg.multiSQL({
        dbcon: pass.dbcon,
        sql:   `
        UPDATE institution
        SET
            institution_name = '${institution_name}',
            institution_url = '${institution_url}',
            ethicapp_url = '${ethicapp_url}',
            physical_address = '${physical_address}',
            institution_logo = '${institution_logo}',
            institution_it_email = '${institution_it_email}',
            institution_educational_email = '${institution_educational_email}';
        `,
        onEnd: (req, res) => {
            res.status(200);
        }
    })(req,res);
});

router.post("/report/:type", async (req, res) => {
    const { type } = req.params;
    const { initialDate, endDate } = req.body;

    const cacheKey = type+"/"+initialDate+"/"+endDate;
    const cachedData = await redisClient.get(cacheKey);
    const cacheTTL = 24 * 60 * 60; // 24 hours in seconds

    if (cachedData !== null) {
        console.log("Cache Passing");
        const parsedData = JSON.parse(cachedData);
        return res.status(200).json(parsedData);
    } else {
        var sqlQuery = "";

        const date1 = new Date(initialDate);
        const date2 = new Date(endDate);
        const differenceInMilliseconds = date2 - date1;
        const millisecondsInMonth = 31 * 24 * 60 * 60 * 1000;
        const differenceInMonths = differenceInMilliseconds / millisecondsInMonth;
        
        switch(type) {
        case "start_activity":
            sqlQuery=`
                SELECT TO_CHAR(creation_date, 'YY-MM-DD') AS date, SUM(count) AS count
                FROM report_activity
                WHERE creation_date >= '${initialDate}' AND creation_date <= '${endDate}'
                GROUP BY creation_date
                ORDER BY creation_date;
            `;
            if (differenceInMonths>1) {
                sqlQuery=`
                SELECT TO_CHAR(creation_date, 'YYYY-MM') AS date, SUM(count) AS count
                FROM report_activity
                WHERE creation_date >= '${initialDate}' AND creation_date <= '${endDate}'
                GROUP BY date
                ORDER BY date;
                `;
            }
            break;

        case "create_account":
            sqlQuery=`
                SELECT TO_CHAR(creation_date, 'YY-MM-DD') AS date, count AS count , is_teacher
                FROM report_create_account
                WHERE creation_date >= '${initialDate}' AND creation_date <= '${endDate}'
                ORDER BY creation_date;
            `;
            if (differenceInMonths>1) {
                sqlQuery=`
                    SELECT TO_CHAR(creation_date, 'YYYY-MM') AS date, 
                    SUM(count) AS count , is_teacher
                    FROM report_create_account
                    WHERE creation_date >= '${initialDate}' AND creation_date <= '${endDate}'
                    GROUP BY date , is_teacher
                    ORDER BY date;
                `;
            }
            break;

        case "logins":
            sqlQuery=`
                SELECT TO_CHAR(login_date, 'YY-MM-DD') AS date, count AS count, is_teacher
                FROM report_login
                WHERE login_date >= '${initialDate}' AND login_date <= '${endDate}'
                ORDER BY login_date;
            `;
            if (differenceInMonths>1) {
                sqlQuery=`
                    SELECT TO_CHAR(login_date, 'YYYY-MM') AS date, SUM(count) AS count, is_teacher
                    FROM report_login
                    WHERE login_date >= '${initialDate}' AND login_date <= '${endDate}'
                    GROUP BY date, is_teacher
                    ORDER BY date;
                `;
            }
            break;

        case "top_professors":
            sqlQuery=`
                SELECT users.name AS date, SUM(count) AS count
                FROM report_activity 
                JOIN users on users.id=report_activity.professor
                WHERE creation_date >= '${initialDate}' AND creation_date <= '${endDate}'
                GROUP BY users.name
                ORDER BY count desc
                LIMIT 10;
            `;
            break;
        }

        rpg.multiSQL({
            dbcon: pass.dbcon,
            sql:   sqlQuery ,
            onEnd: (req,res,results) => {

                var x_data=[];
                var y1_data=[];
                var y2_data=[];

                results.forEach(element => {
                    x_data.push(element["date"]);
                    if (type == "create_account" || type == "logins") {
                        if (element["is_teacher"]=="0") {
                            y1_data.push(parseInt(element["count"]));
                        }else{
                            y2_data.push(parseInt(element["count"]));
                        }
                    }else{
                        y1_data.push(parseInt(element["count"]));
                    }
                });

                let json_query={
                    "report_title":   `${type} : ${initialDate} - ${endDate}`,
                    "report_x_data":  x_data,
                    "report_y1_data": y1_data,
                    "report_y2_data": y2_data,
                    "report_type":    type,
                    "creation_date":  CurrentDate()
                };

                redisClient.setex(cacheKey, cacheTTL, JSON.stringify(json_query));

                return res.status(200).json(json_query);
            }
        })(req,res);
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

module.exports = router;
