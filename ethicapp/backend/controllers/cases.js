"use strict";

const express = require("express");
const rpg = require("../db/rest-pg");
const pg = require("pg");
const router = express.Router();


const dbcon = 'postgres://ethicapp:ethicapp@postgres:5432/ethicapp_dev'

var DB = null;

function getDBInstance(dbcon) {
    if(DB == null) {
        DB = new pg.Client(dbcon);
        DB.connect();
        DB.on("error", function(err){
            console.error(err);
            DB = null;
        });
        return DB;
    }
    return DB;
}

router.get("/topics", (req, res) => {
    const sql = `
    SELECT * FROM topics
    `;
    const db = getDBInstance(dbcon);

    let result;
    const qry = db.query(sql,(err,res) =>{
        if(res != null){
            result = JSON.stringify(res.rows);  
        }
    });;

    qry.on("end", function () {
        res.end('{"status":"ok", "result":'+result+"}");
    });
    qry.on("error", function(err){
        console.error(`Fatal error on the SQL query "${sql}"`);
        console.error(err);
        res.end('{"status":"err"}');
    });
});



router.get("/topics/:id", (req, res) => {
    const topicId = req.params.id;
    const sql = `
    SELECT * FROM topics
    WHERE topic_id = $1
    `;
    const db = getDBInstance(dbcon);

    const qry = db.query(sql, [topicId]);

    qry.on("end", function (result) {
        if (result.rows.length === 0) {
            res.status(404).json({ status: 'error', message: 'No se encontró el Topico con el ID proporcionado' });
        } else {
            res.status(200).json({ status: 'success', data: result.rows[0] });
        }
    });

    qry.on("error", function (err) {
        console.error(`Fatal error on the SQL query "${sql}"`);
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Error en la base de datos' });
    });
});


router.post("/topics", (req, res) => {
    const { name } = req.body;
    const sql = `
    INSERT INTO topics (name)
    VALUES ('${name}')
    `;

    rpg.execSQL({
        dbcon: dbcon,
        sql:   sql
    })(req, res);
});

router.delete("/topics/:id", (req, res) => {
    const topicId = req.params.id;
    const sql = `
    DELETE FROM topics
    WHERE topic_id = $1
    `;
    const db = getDBInstance(dbcon);

    const qry = db.query(sql, [topicId]);

    qry.on("end", function (result) {
        if (result.rowCount === 0) {
            res.status(404).json({ status: 'error', message: 'No se encontró el Topico con el ID proporcionado' });
        } else {
            res.status(200).json({ status: 'success', message: 'Topico eliminado exitosamente' });
        }
    });

    qry.on("error", function (err) {
        console.error(`Fatal error on the SQL query "${sql}"`);
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Error en la base de datos' });
    });
});

































router.get("/cases", (req, res) => {
    const sql = `
    SELECT c.*, ARRAY_AGG(ct.topic_id) AS topicIds
    FROM cases c
    LEFT JOIN cases_topics ct ON c.case_id = ct.case_id
    GROUP BY c.case_id
    `;
    const db = getDBInstance(dbcon);

    db.query(sql)
        .then(result => {
            // Mapear cada caso y convertir los topicIds en un array
            const casesWithTopics = result.rows.map(row => {
                return {
                    ...row,
                };
            });
            res.status(200).json({ status: 'ok', result: casesWithTopics });
        })
        .catch(err => {
            console.error(`Fatal error on the SQL query "${sql}"`);
            console.error(err);
            res.status(500).json({ status: 'error', message: 'Error en la base de datos' });
        });
});

router.get("/cases/:id", (req, res) => {
    const caseId = req.params.id;
    const sql = `
    SELECT c.*, ARRAY_AGG(ct.topic_id) AS topicIds
    FROM cases c
    LEFT JOIN cases_topics ct ON c.case_id = ct.case_id
    WHERE c.case_id = $1
    GROUP BY c.case_id
    `;
    const db = getDBInstance(dbcon);

    db.query(sql, [caseId])
        .then(result => {
            if (result.rows.length === 0) {
                res.status(404).json({ status: 'error', message: 'No se encontró el Caso con el ID proporcionado' });
            } else {
                // Convertir los topicIds en un array y adjuntarlos al caso
                const caso = {
                    ...result.rows[0]
                };
                res.status(200).json({ status: 'success', data: caso });
            }
        })
        .catch(err => {
            console.error(`Fatal error on the SQL query "${sql}"`);
            console.error(err);
            res.status(500).json({ status: 'error', message: 'Error en la base de datos' });
        });
});



router.post("/cases", (req, res) => {
    const { title, description, external_case_url, topicIds } = req.body;

    const caseInsertQuery = `
    INSERT INTO cases (title, description, external_case_url)
    VALUES ($1, $2, $3)
    RETURNING case_id
    `;
    const db = getDBInstance(dbcon);

    db.query(caseInsertQuery, [title, description, external_case_url])
        .then(result => {
            const caseId = result.rows[0].case_id; // Obtener el ID del caso insertado
            // Insertar registros en la tabla de casos y temas (cases_topics)
            const caseTopicsInsertQuery = `
            INSERT INTO cases_topics (case_id, topic_id)
            VALUES ${topicIds.map((_, index) => `($1, $${index + 2})`).join(', ')}
            `;
            return db.query(caseTopicsInsertQuery, [caseId, ...topicIds]);
        })
        .then(() => {
            res.status(201).json({ status: 'success', message: 'Caso creado exitosamente' });
        })
        .catch(err => {
            console.error("Error al insertar el caso:", err);
            res.status(500).json({ status: 'error', message: 'Error interno del servidor' });
        });
});




router.delete("/cases/:id", (req, res) => {
    const caseId = req.params.id;
    const db = getDBInstance(dbcon);

    // Eliminar entradas en la tabla cases_topics relacionadas con el caso
    const deleteCaseTopicsQuery = `
    DELETE FROM cases_topics
    WHERE case_id = $1
    `;
    
    db.query(deleteCaseTopicsQuery, [caseId])
        .then(() => {
            // Ahora que se han eliminado las entradas relacionadas, podemos eliminar el caso
            const deleteCaseQuery = `
            DELETE FROM cases
            WHERE case_id = $1
            `;
            return db.query(deleteCaseQuery, [caseId]);
        })
        .then(result => {
            if (result.rowCount === 0) {
                res.status(404).json({ status: 'error', message: 'No se encontró el Caso con el ID proporcionado' });
            } else {
                res.status(200).json({ status: 'success', message: 'Caso eliminado exitosamente' });
            }
        })
        .catch(err => {
            console.error("Error al eliminar el caso:", err);
            res.status(500).json({ status: 'error', message: 'Error interno del servidor' });
        });
});
























router.get("/cases_topics", (req, res) => {
    const sql = `
    SELECT * FROM cases_topics
    `;
    const db = getDBInstance(dbcon);

    let result;
    const qry = db.query(sql,(err,res) =>{
        if(res != null){
            result = JSON.stringify(res.rows);  
        }
    });;

    qry.on("end", function () {
        res.end('{"status":"ok", "result":'+result+"}");
    });
    qry.on("error", function(err){
        console.error(`Fatal error on the SQL query "${sql}"`);
        console.error(err);
        res.end('{"status":"err"}');
    });
});




module.exports = router;