"use strict";

const express = require("express");
const rpg = require("../db/rest-pg");
const pg = require("pg");
const router = express.Router();
const pass = require("../config/keys-n-secrets");
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const authorize = require("../middleware/case-manager");

const dbcon = pass.dbcon
var DB = null;


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

// TODO: With req.user

router.get("/topic-tags", (req, res) => {
    const sql = `
    SELECT * FROM topic_tags
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


router.get("/topic-tags/:id", (req, res) => {
    const topicTagId = req.params.id;
    const sql = `
    SELECT * FROM topic_tags
    WHERE topic_tag_id = $1
    `;
    const db = getDBInstance(dbcon);

    const qry = db.query(sql, [topicTagId]);

    qry.on("end", function (result) {
        if (result.rows.length === 0) {
            res.status(404).json({ status: 'error', message: 'could not find the topic id' });
        } else {
            res.status(200).json({ status: 'success', data: result.rows[0] });
        }
    });

    qry.on("error", function (err) {
        console.error(`Fatal error on the SQL query "${sql}"`);
        console.error(err);
        res.status(500).json({ status: 'error', message: '' });
    });
});


router.post("/topic-tags", (req, res) => {
    const { name } = req.body;
    const sql = `
    INSERT INTO topic_tags (name)
    VALUES ('${name}')
    `;

    rpg.execSQL({
        dbcon: dbcon,
        sql:   sql
    })(req, res);
});


router.delete("/topic-tags/:id", (req, res) => {
    const topicTagId = req.params.id;
    const sql = `
    DELETE FROM topic_tags
    WHERE topic_tag_id = $1
    `;
    const db = getDBInstance(dbcon);

    const qry = db.query(sql, [topicTagId]);

    qry.on("end", function (result) {
        if (result.rowCount === 0) {
            res.status(404).json({ status: 'error', message: 'could not find the topic id' });
        } else {
            res.status(200).json({ status: 'success', message: 'Topic deleted' });
        }
    });

    qry.on("error", function (err) {
        console.error(`Fatal error on the SQL query "${sql}"`);
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Error in the DB' });
    });
});


router.get("/cases-topic-tags", (req, res) => {
    const sql = `
    SELECT * FROM cases_topic_tags
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
        res.status(500).json({ status: 'error', message: 'Error in the DB' });
    });
});


router.get("/users/:userId/cases", (req, res) => {
    const userId = req.params.userId;

    const sql = `
    SELECT c.case_id, c.title, c.description, c.is_public, c.external_case_url, c.user_id,
           ARRAY_AGG(DISTINCT jsonb_build_object('id', tt.topic_tag_id, 'name', tt.name)) AS topic_tags, 
           ARRAY_AGG(DISTINCT dd.id) AS document_ids, 
           ARRAY_AGG(DISTINCT dd.path) AS document_paths
    FROM cases c
    LEFT JOIN cases_topic_tags ct ON c.case_id = ct.case_id
    LEFT JOIN designs_documents dd ON c.case_id = dd.case_id
    LEFT JOIN topic_tags tt ON ct.topic_tag_id = tt.topic_tag_id
    WHERE c.user_id = $1
    GROUP BY c.case_id
    `;
    const db = getDBInstance();

    db.query(sql, [userId])
        .then(result => {
            const _cases = result.rows.map(row => {
                return {
                    case_id: row.case_id,
                    title: row.title,
                    description: row.description,
                    is_public: row.is_public,
                    external_case_url: row.external_case_url,
                    user_id: row.user_id,
                    topic_tags: row.topic_tags.filter(tag => tag.id !== null), // Filtrar los tags que no existen
                    documents: row.document_ids.map((id, index) => ({ id, path: row.document_paths[index] })).filter(doc => doc.id !== null) // Crear una lista de objetos { id, path }
                };
            });

            res.status(200).json({ status: 'ok', result: _cases });
        })
        .catch(err => {
            console.error(`Fatal error on the SQL query "${sql}"`);
            console.error(err);
            res.status(500).json({ status: 'error', message: 'Error in the DB' });
        });
});


router.get("/cases", (req, res) => {

    const sql = `
    SELECT c.case_id, c.title, c.description, c.is_public, c.external_case_url, c.user_id,
           ARRAY_AGG(DISTINCT jsonb_build_object('id', tt.topic_tag_id, 'name', tt.name)) AS topic_tags, 
           ARRAY_AGG(DISTINCT dd.id) AS document_ids, 
           ARRAY_AGG(DISTINCT dd.path) AS document_paths
    FROM cases c
    LEFT JOIN cases_topic_tags ct ON c.case_id = ct.case_id
    LEFT JOIN designs_documents dd ON c.case_id = dd.case_id
    LEFT JOIN topic_tags tt ON ct.topic_tag_id = tt.topic_tag_id
    GROUP BY c.case_id
    `;
    const db = getDBInstance(dbcon);

    console.log(db);
    db.query(sql)
        .then(result => {
            console.log(result);
            const _cases = result.rows.map(row => {
                return {
                    case_id: row.case_id,
                    title: row.title,
                    description: row.description,
                    is_public: row.is_public,
                    external_case_url: row.external_case_url,
                    user_id: row.user_id,
                    topic_tags: row.topic_tags.filter(tag => tag.id !== null), // Filtrar los tags que no existen
                    documents: row.document_ids.map((id, index) => ({ id, path: row.document_paths[index] })).filter(doc => doc.id !== null) // Crear una lista de objetos { id, path }
                };
            });

            res.status(200).json({ status: 'ok', result: _cases });
        })
        .catch(err => {
            console.error(`Fatal error on the SQL query "${sql}"`);
            console.error(err);
            res.status(500).json({ status: 'error', message: 'Error in the DB' });
        });
});


router.get("/cases/:id", (req, res) => {
    const caseId = req.params.id;
    const sql = `
    SELECT c.case_id, c.title, c.description, c.is_public, c.external_case_url, c.user_id,
           ARRAY_AGG(DISTINCT jsonb_build_object('id', tt.topic_tag_id, 'name', tt.name)) AS topic_tags, 
           ARRAY_AGG(DISTINCT dd.id) AS document_ids, 
           ARRAY_AGG(DISTINCT dd.path) AS document_paths
    FROM cases c
    LEFT JOIN cases_topic_tags ct ON c.case_id = ct.case_id
    LEFT JOIN designs_documents dd ON c.case_id = dd.case_id
    LEFT JOIN topic_tags tt ON ct.topic_tag_id = tt.topic_tag_id
    WHERE c.case_id = $1
    GROUP BY c.case_id
    `;
    const db = getDBInstance(dbcon);
    
    db.query(sql, [caseId])
        .then(result => {
            if (result.rows.length === 0) {
                res.status(404).json({ status: 'error', message: 'Could not find case with id' });
            } else {
                const row = result.rows[0];
                const _case = {
                    case_id: row.case_id,
                    title: row.title,
                    description: row.description,
                    is_public: row.is_public,
                    external_case_url: row.external_case_url,
                    user_id: row.user_id,
                    topic_tags: row.topic_tags.filter(tag => tag.id !== null), // Filtrar los tags que no existen
                    documents: row.document_ids.map((id, index) => ({ id, path: row.document_paths[index] })).filter(doc => doc.id !== null) // Crear una lista de objetos { id, path }
                };

                res.status(200).json({ status: 'success', data: _case });
            }
        })
        .catch(err => {
            console.error(`Fatal error on the SQL query "${sql}"`);
            console.error(err);
            res.status(500).json({ status: 'error', message: 'Error in the DB' });
        });
});


router.post("/cases", (req, res) => {
    const caseInsertQuery = `
    INSERT INTO cases (is_public)
    VALUES (false)
    RETURNING case_id
    `;
    const db = getDBInstance(dbcon);

    db.query(caseInsertQuery)
        .then(result => {
            const caseId = result.rows[0].case_id;
            res.status(201).json({ status: 'success', message: 'Case created', caseId: caseId });
        })
        .catch(err => {
            console.error("Error creating case:", err);
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        });
});


router.patch("/cases/:caseId", (req, res) => {
    const caseId = req.params.caseId;
    const { title, description, external_case_url, is_public, topic_tag_ids, user_id } = req.body;

    const updateCaseQuery = `
    UPDATE cases 
    SET title = COALESCE($2, title), 
        description = COALESCE($3, description), 
        external_case_url = COALESCE($4, external_case_url),
        is_public = COALESCE($5, is_public),
        user_id = COALESCE($6, user_id)
    WHERE case_id = $1
    `;
    const db = getDBInstance(dbcon);

    db.query(updateCaseQuery, [caseId, title, description, external_case_url, is_public, user_id])
        .then(() => {
            if (!topic_tag_ids) {
                return; // No cambiar los topic tags existentes
            }

            // Eliminar todos los topic tags existentes para este caso
            const deletePreviousTopicsQuery = `
            DELETE FROM cases_topic_tags 
            WHERE case_id = $1
            `;
            return db.query(deletePreviousTopicsQuery, [caseId]);
        })
        .then(() => {
            if (!topic_tag_ids|| topic_tag_ids.length === 0) {
                return; // No agregar nuevos topic tags si topic_tag_ids es null o una lista vacía
            }

            // Insertar los nuevos topic tags
            const caseTopicsInsertQuery = `
            INSERT INTO cases_topic_tags (case_id, topic_tag_id)
            VALUES ${topic_tag_ids.map((_, index) => `($1, $${index + 2})`).join(', ')}
            `;
            return db.query(caseTopicsInsertQuery, [caseId, ...topic_tag_ids]);
        })
        .then(() => {
            res.status(200).json({ status: 'success', message: 'Case updated' });
        })
        .catch(err => {
            console.error("Error updating case:", err);
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        });
});


router.post("/cases/:caseId/documents", (req, res) => {
    const caseId = req.params.caseId;

    const checkCaseQuery = `
    SELECT * FROM cases WHERE case_id = $1
    `;
    const db = getDBInstance(dbcon);

    db.query(checkCaseQuery, [caseId])
        .then(result => {
            if (result.rows.length === 0) {
                return res.status(404).json({ status: 'error', message: 'Case do not exist' });
            }
            
            if (req.files == null || req.files.pdf == null) {
                return res.status(400).json({ status: 'error', message: 'No file passed' });
            }

            if (!Array.isArray(req.files.pdf)) {
                req.files.pdf = [req.files.pdf]; 
            } 

            req.files.pdf.forEach(fileData => {
                const path = fileData.file.split("uploads")[1];
        
                const insertDocumentQuery = `
                INSERT INTO designs_documents (path, case_id)
                VALUES ($1, $2)
                `;
        
                db.query(insertDocumentQuery, [path, caseId]);
            });
            
        })
        .then(() => {
            res.status(201).json({ status: 'success', message: 'Document uploaded' });
        })
        .catch(err => {
            console.error("Error creating document: ", err);
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        });
});


router.get("/designs/:id/case", (req, res) => {
    const designId = req.params.id;
    const sql = `
    SELECT c.case_id, c.title, c.description, c.is_public, c.external_case_url, c.user_id,
           ARRAY_AGG(DISTINCT jsonb_build_object('id', tt.topic_tag_id, 'name', tt.name)) AS topic_tags, 
           ARRAY_AGG(DISTINCT dd.id) AS document_ids, 
           ARRAY_AGG(DISTINCT dd.path) AS document_paths
    FROM cases c
    LEFT JOIN cases_topic_tags ct ON c.case_id = ct.case_id
    LEFT JOIN designs_documents dd ON c.case_id = dd.case_id
    LEFT JOIN topic_tags tt ON ct.topic_tag_id = tt.topic_tag_id
    LEFT JOIN designs d ON c.case_id = d.case_id
    WHERE d.id = $1
    GROUP BY c.case_id
    `;
    const db = getDBInstance(dbcon);
    
    db.query(sql, [designId])
        .then(result => {
            if (result.rows.length === 0) {
                res.status(404).json({ status: 'error', message: 'Could not find a case associated with the design with the provided ID' });
                    
            } else {
                const row = result.rows[0];
                const _case = {
                    case_id: row.case_id,
                    title: row.title,
                    description: row.description,
                    is_public: row.is_public,
                    external_case_url: row.external_case_url,
                    user_id: row.user_id,
                    topic_tags: row.topic_tags.filter(tag => tag.id !== null), // Filtrar los tags que no existen
                    documents: row.document_ids.map((id, index) => ({ id, path: row.document_paths[index] })).filter(doc => doc.id !== null) // Crear una lista de objetos { id, path }
                };

                res.status(200).json({ status: 'success', data: _case });
            }
        })
        .catch(err => {
            console.error(`Fatal error on the SQL query "${sql}"`);
            console.error(err);
            res.status(500).json({ status: 'error', message: 'Error in the DB' });
        });
});


router.delete("/cases/:caseId/documents/:documentId", (req, res) => {
    const caseId = req.params.caseId;
    const documentId = req.params.documentId;

    const getDocumentPathQuery = `
    SELECT path
    FROM designs_documents
    WHERE case_id = $1 AND id = $2
    `;
    const deleteDocumentQuery = `
    DELETE FROM designs_documents
    WHERE case_id = $1 AND id = $2
    `;
    const db = getDBInstance(dbcon);

    db.query(getDocumentPathQuery, [caseId, documentId])
        .then(result => {
            if (result.rows.length === 0) {
                res.status(404).json({ status: 'error', message: 'Could not find the document with the provided ID' });
                return null;
            } else {
                const documentPath = result.rows[0].path;
                return db.query(deleteDocumentQuery, [caseId, documentId])
                    .then(deleteResult => {
                        if (deleteResult.rowCount === 0) {
                            res.status(500).json({ status: 'error', message: 'Could not delete document from DB' });
                            return null;
                        } else {
                            return documentPath;
                        }
                    });
            }
        })
        .then(documentPath => {
            if (documentPath) {
                // Ruta de la carpeta que contiene el archivo
                const folderPath = path.join(pass.uploadPath, path.dirname(documentPath)).split("pdf")[0];

                fs.rmdir(folderPath, { recursive: true }, (err) => {
                    if (err) {
                        console.error("Error deleting folder:", err);
                        res.status(500).json({ status: 'error', message: 'Error deleting folder' });
                    } else {
                        res.status(204).end();
                    }
                });
            }
        })
        .catch(err => {
            console.error("Error deleting document:", err);
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        });
});


router.delete("/cases/:caseId", (req, res) => {
    const caseId = req.params.caseId;

    const getDocumentsQuery = `
    SELECT path
    FROM designs_documents
    WHERE case_id = $1
    `;
    const deleteDocumentsQuery = `
    DELETE FROM designs_documents
    WHERE case_id = $1
    `;
    const deleteCaseTagsQuery = `
    DELETE FROM cases_topic_tags
    WHERE case_topic_id = $1
    `;
    const deleteCaseQuery = `
    DELETE FROM cases
    WHERE case_id = $1
    `;
    const db = getDBInstance();

    db.query(getDocumentsQuery, [caseId])
        .then(result => {
            const documentPaths = result.rows.map(row => row.path);

            return db.query(deleteDocumentsQuery, [caseId])
                .then(deleteResult => {
                    if (deleteResult.rowCount === 0 && documentPaths.length > 0) {
                        res.status(500).json({ status: 'error', message: 'Could not delete document from DB' });
                        return null;
                    } else {
                        return documentPaths;
                    }
                });
        })
        .then(documentPaths => {
            if (documentPaths) {
                documentPaths.forEach(documentPath => {
                    const folderPath = path.join(pass.uploadPath, path.dirname(documentPath)).split("pdf")[0];

                    fs.rmdir(folderPath, { recursive: true }, (err) => {
                        if (err) {
                            console.error("Error when deleting folder", err);
                        } else {
                            console.log('Folder deleted successfully');
                        }
                    });
                });

                return db.query(deleteCaseTagsQuery, [caseId]);
            }
        })
        .then(() => {
            return db.query(deleteCaseQuery, [caseId])
                .then(deleteResult => {
                    if (deleteResult.rowCount === 0) {
                        res.status(500).json({ status: 'error', message: 'Could not delete case' });
                    } else {
                        res.status(204).end();
                    }
                });
        })
        .catch(err => {
            console.error("Error deleting case:", err);
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        });
});


router.post("/cases/:caseId/clone", (req, res) => {
    const caseId = req.params.caseId;
    const db = getDBInstance(dbcon);

    // Paso 1: Copiar el caso
    const caseQuery = `
        INSERT INTO cases (title, description, is_public, external_case_url, user_id)
        SELECT title, description, is_public, external_case_url, user_id
        FROM cases
        WHERE case_id = $1
        RETURNING case_id
    `;

    db.query(caseQuery, [caseId])
        .then(caseResult => {
            const newCaseId = caseResult.rows[0].case_id;

            // Paso 2: Copiar las etiquetas
            const tagsQuery = `
                INSERT INTO cases_topic_tags (case_id, topic_tag_id)
                SELECT $2, topic_tag_id
                FROM cases_topic_tags
                WHERE case_id = $1
            `;

            return db.query(tagsQuery, [caseId, newCaseId])
                .then(() => newCaseId);
        })
        .then(newCaseId => {
            // Paso 3: Copiar los documentos
            const documentsQuery = `
                SELECT id, path
                FROM designs_documents
                WHERE case_id = $1
            `;

            db.query(documentsQuery, [caseId])
                .then(documentsResult => {
                    documentsResult.rows.forEach(doc => {
                        const oldRelativePath = doc.path;
                        const oldFullPath = path.join('frontend/assets/uploads', oldRelativePath);

                        const newHash = crypto.randomBytes(16).toString('hex'); // Generar un nuevo hash para cada archivo
                        const newDirectory = path.join('frontend/assets/uploads', newHash, 'pdf');
                        const newRelativePath = path.join(newHash, 'pdf', path.basename(oldRelativePath));
                        const newFullPath = path.join(newDirectory, path.basename(oldRelativePath));

                        // Crear el nuevo directorio si no existe
                        if (!fs.existsSync(newDirectory)) {
                            fs.mkdirSync(newDirectory, { recursive: true });
                        }

                        // Verificar si el archivo existe antes de copiarlo
                        if (fs.existsSync(oldFullPath)) {
                            // Clonar el archivo físico
                            fs.copyFileSync(oldFullPath, newFullPath);

                            // Insertar la nueva ruta del documento en la base de datos
                            const insertDocumentQuery = `
                                INSERT INTO designs_documents (path, case_id)
                                VALUES ($1, $2)
                            `;

                            db.query(insertDocumentQuery, [newRelativePath, newCaseId]);
                        } else {
                            console.error(`The file do not exist: ${oldFullPath}`);
                        }
                    });
                })
                .then(() => {
                    res.status(201).json({ status: 'success', message: 'Case cloned successfully', newCaseId });
                })
                .catch(err => {
                    console.error("Error cloning documents", err);
                    res.status(500).json({ status: 'error', message: 'Internal server error' });
                });
        })
        .catch(err => {
            console.error("Error cloning case", err);
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        });
});

router.get("/desings_docs/", (req, res) => {
    const sql = `
    SELECT * FROM designs_documents
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



router.get("/hello", (req, res) => {
   res.send("Hello, world!");
    
});




    
module.exports = router;
