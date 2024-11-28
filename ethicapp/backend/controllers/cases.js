"use strict";

const express = require("express");
const pg = require("pg");
const router = express.Router();
const pass = require("../config/keys-n-secrets");
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const authorize = require("../middleware/case-abilities");


const dbcon = pass.dbcon
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


router.get("/cases", async (req, res) => {
    const userId = req.user.id;

    const sqlCases = `
    SELECT c.case_id, c.title, c.description, c.is_public, c.external_case_url, c.user_id, c.created_at, c.updated_at,
           ARRAY_AGG(DISTINCT jsonb_build_object('name', tt.name)) AS topic_tags, 
           u.name AS creator -- Obtener el nombre del creador
    FROM cases c
    LEFT JOIN cases_topic_tags ct ON c.case_id = ct.case_id
    LEFT JOIN topic_tags tt ON ct.topic_tag_name = tt.name
    LEFT JOIN users u ON c.user_id = u.id -- Unión con la tabla de usuarios
    GROUP BY c.case_id, u.name
    ORDER BY c.updated_at DESC
    `;

    const sqlDesigns = `
    SELECT case_id, COUNT(*) FILTER (WHERE locked = true) AS locked_count
    FROM designs
    GROUP BY case_id
    `;

    try {
        const db = getDBInstance(dbcon);

        const [casesResult, designsResult] = await Promise.all([db.query(sqlCases), db.query(sqlDesigns)]);

        const designsMap = new Map(designsResult.rows.map(row => [row.case_id, row.locked_count > 0]));

        const myCases = [];
        const publicCases = [];

        casesResult.rows.forEach(row => {
            const _case = {
                case_id: row.case_id,
                title: row.title,
                description: row.description,
                is_public: row.is_public,
                external_case_url: row.external_case_url,
                user_id: row.user_id,
                creator: row.creator,
                topic_tags: row.topic_tags.filter(tag => tag.name !== null),
                created_at: row.created_at,
                updated_at: row.updated_at,
                locked: designsMap.get(row.case_id) || false 
            };

            if (row.user_id === userId) {
                myCases.push(_case);
            } else if (row.is_public) {
                publicCases.push(_case);
            }
        });

        res.status(200).json({
            status: 'ok',
            result: {
                my_cases: myCases,
                public_cases: publicCases
            }
        });

    } catch (err) {
        console.error(`Fatal error on the SQL queries`);
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Error in the DB' });
    }
});



router.get("/cases/:id", async (req, res) => {
    const caseId = req.params.id;
    const sql = `
    SELECT c.case_id, c.title, c.description, c.is_public, c.external_case_url, c.user_id, c.created_at, c.updated_at, c.rich_text,
           ARRAY_AGG(DISTINCT jsonb_build_object('name', tt.name)) AS topic_tags, 
           ARRAY_AGG(DISTINCT jsonb_build_object('id', dd.id, 'path', dd.path, 'name', dd.name)) AS documents
    FROM cases c
    LEFT JOIN cases_topic_tags ct ON c.case_id = ct.case_id
    LEFT JOIN designs_documents dd ON c.case_id = dd.case_id
    LEFT JOIN topic_tags tt ON ct.topic_tag_name = tt.name
    WHERE c.case_id = $1
    GROUP BY c.case_id
    `;
    
    const db = getDBInstance(dbcon);

    try {
        const result = await db.query(sql, [caseId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Could not find case with id' });
        }

        const row = result.rows[0];
        const _case = {
            case_id: row.case_id,
            title: row.title,
            description: row.description,
            rich_text: row.rich_text,
            is_public: row.is_public,
            external_case_url: row.external_case_url,
            user_id: row.user_id,
            topic_tags: row.topic_tags.filter(tag => tag.name !== null),
            documents: row.documents.filter(doc => doc.id !== null),
            created_at: row.created_at,
            updated_at: row.updated_at
        };

        res.status(200).json({ status: 'success', result: _case });
    } catch (err) {
        console.error(`Fatal error on the SQL query "${sql}"`);
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Error in the DB' });
    }
});


router.post("/cases", async (req, res) => {
    const caseInsertQuery = `
    INSERT INTO cases (user_id)
    VALUES ($1)
    RETURNING case_id
    `;
    const db = getDBInstance(dbcon);

    try {
        const result = await db.query(caseInsertQuery, [req.user.id]);
        const caseId = result.rows[0].case_id;
        res.status(201).json({ status: 'success', message: 'Case created', caseId: caseId });
    } catch (err) {
        console.error("Error creating case:", err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});



router.patch("/cases/:caseId", async (req, res) => {
    const caseId = req.params.caseId;
    const { title, description, external_case_url, is_public, topic_tags, rich_text } = req.body;
    const db = getDBInstance(dbcon);

    try {
        const updateCaseQuery = `
        UPDATE cases 
        SET title = COALESCE($2, title), 
            description = COALESCE($3, description), 
            external_case_url = COALESCE($4, external_case_url),
            is_public = COALESCE($5, is_public),
            rich_text = COALESCE($6, rich_text),
            updated_at = NOW()
        WHERE case_id = $1
        `;
        await db.query(updateCaseQuery, [caseId, title, description, external_case_url, is_public, rich_text]);

        const deletePreviousTopicsQuery = `
        DELETE FROM cases_topic_tags 
        WHERE case_id = $1
        `;
        await db.query(deletePreviousTopicsQuery, [caseId]);

        if (topic_tags && topic_tags.length > 0) {
            const uniqueTags = [...new Set(topic_tags.map(tag => tag.name))];
            const checkAndInsertTagsQuery = `
            INSERT INTO topic_tags (name)
            VALUES ${uniqueTags.map((_, i) => `($${i + 1})`).join(', ')}
            ON CONFLICT (name) DO NOTHING
            `;
            await db.query(checkAndInsertTagsQuery, uniqueTags);

            const caseTopicsInsertQuery = `
            INSERT INTO cases_topic_tags (case_id, topic_tag_name)
            VALUES ${uniqueTags.map((_, i) => `($1, $${i + 2})`).join(', ')}
            `;
            await db.query(caseTopicsInsertQuery, [caseId, ...uniqueTags]);
        }

        await db.query('COMMIT');

        res.status(200).json({ status: 'success', message: 'Case updated' });

    } catch (err) {
        await db.query('ROLLBACK');
        console.error("Error updating case:", err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});


router.post("/cases/:caseId/documents", async (req, res) => {
    const caseId = req.params.caseId;
    const db = getDBInstance(dbcon);

    try {
        const checkCaseQuery = `SELECT * FROM cases WHERE case_id = $1`;
        const caseResult = await db.query(checkCaseQuery, [caseId]);

        if (caseResult.rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Case does not exist' });
        }

        if (!req.files || !req.files.pdf) {
            return res.status(400).json({ status: 'error', message: 'No file passed' });
        }

        const pdfFiles = Array.isArray(req.files.pdf) ? req.files.pdf : [req.files.pdf];

        const insertedDocuments = [];

        for (const fileData of pdfFiles) {
            const path = fileData.file.split("frontend")[1];
            const name = path.split("pdf/").pop();

            const insertDocumentQuery = `
                INSERT INTO designs_documents (path, case_id, name)
                VALUES ($1, $2, $3)
                RETURNING id, path, name
            `;

            const insertResult = await db.query(insertDocumentQuery, [path, caseId, name]);

            insertedDocuments.push(insertResult.rows[0]);
        }

        res.status(201).json({ status: 'success', result: insertedDocuments });

    } catch (err) {
        console.error("Error creating document: ", err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});


router.patch("/designs/:id/case", async (req, res) => {
    const designId = req.params.id;
    const { caseId } = req.body;

    if (!caseId) {
        return res.status(400).json({ status: 'error', message: 'Case ID is required' });
    }

    const updateDesignQuery = `
    UPDATE designs
    SET case_id = $2
    WHERE id = $1
    `;
    const db = getDBInstance(dbcon);

    try {
        await db.query(updateDesignQuery, [designId, caseId]);
        res.status(200).json({ status: 'success', message: 'Design updated' });
    } catch (err) {
        console.error("Error updating design:", err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});


router.get("/designs/:id", async (req, res) => {
    const designId = req.params.id;
    const sql = `
    SELECT * FROM designs WHERE id = $1
    `;
    const db = getDBInstance(dbcon);

    try {
        const result = await db.query(sql, [designId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Could not find a design with the provided ID' });
        }

        res.status(200).json({ status: 'success', result: result.rows[0] });
    } catch (err) {
        console.error(`Fatal error on the SQL query "${sql}"`);
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Error in the DB' });
    }
});


router.get("/designs/:id/case", async (req, res) => {
    const designId = req.params.id;
    const sql = `
    SELECT c.case_id, c.title, c.description, c.is_public, c.external_case_url, c.user_id, c.created_at, c.updated_at, c.rich_text,
           ARRAY_AGG(DISTINCT jsonb_build_object('name', tt.name)) AS topic_tags, 
           ARRAY_AGG(DISTINCT jsonb_build_object('id', dd.id, 'path', dd.path, 'name', dd.name)) AS documents,
           u.name AS creator -- Obtener el nombre del creador
    FROM cases c
    LEFT JOIN cases_topic_tags ct ON c.case_id = ct.case_id
    LEFT JOIN designs_documents dd ON c.case_id = dd.case_id
    LEFT JOIN topic_tags tt ON ct.topic_tag_name = tt.name
    LEFT JOIN users u ON c.user_id = u.id -- Unión con la tabla de usuarios para obtener el creador
    LEFT JOIN designs d ON c.case_id = d.case_id
    WHERE d.id = $1
    GROUP BY c.case_id, u.name
    `;
    const db = getDBInstance(dbcon);

    try {
        const result = await db.query(sql, [designId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Could not find a case associated with the design with the provided ID' });
        }

        const row = result.rows[0];
        const _case = {
            case_id: row.case_id,
            title: row.title,
            description: row.description,
            is_public: row.is_public,
            rich_text: row.rich_text,
            external_case_url: row.external_case_url,
            user_id: row.user_id,
            creator: row.creator,
            topic_tags: row.topic_tags.filter(tag => tag.name !== null),
            documents: row.documents.filter(doc => doc.id !== null),
            created_at: row.created_at,
            updated_at: row.updated_at
        };

        res.status(200).json({ status: 'success', result: _case });
    } catch (err) {
        console.error(`Fatal error on the SQL query "${sql}"`);
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Error in the DB' });
    }
});


router.delete("/cases/:caseId/documents/:documentId", async (req, res) => {
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

    try {
        const result = await db.query(getDocumentPathQuery, [caseId, documentId]);
        
        if (result.rows.length === 0) {
            res.status(404).json({ status: 'error', message: 'Could not find the document with the provided ID' });
            return;
        }

        const documentPath = result.rows[0].path;
        const deleteResult = await db.query(deleteDocumentQuery, [caseId, documentId]);

        if (deleteResult.rowCount === 0) {
            res.status(500).json({ status: 'error', message: 'Could not delete document from DB' });
            return;
        }

        const folderPath = path.join("frontend", path.dirname(documentPath)).split("pdf")[0];
        console.log("folderPath", folderPath);

        fs.rmdir(folderPath, { recursive: true }, (err) => {
            if (err) {
                console.error("Error deleting folder:", err);
                res.status(500).json({ status: 'error', message: 'Error deleting folder' });
            } else {
                console.log(folderPath, 'deleted successfully');
                res.status(204).end();
            }
        });
        
    } catch (err) {
        console.error("Error deleting document:", err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});



router.delete("/cases/:caseId", async (req, res) => {
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
    WHERE case_id = $1
    `;
    const deleteCaseQuery = `
    DELETE FROM cases
    WHERE case_id = $1
    `;
    const updateDesignsQuery = `
    UPDATE designs
    SET case_id = NULL
    WHERE case_id = $1
    `;
    const db = getDBInstance();

    try {
        await db.query(updateDesignsQuery, [caseId]);

        const result = await db.query(getDocumentsQuery, [caseId]);
        const documentPaths = result.rows.map(row => row.path);

        const deleteDocumentsResult = await db.query(deleteDocumentsQuery, [caseId]);
        if (deleteDocumentsResult.rowCount === 0 && documentPaths.length > 0) {
            return res.status(500).json({ status: 'error', message: 'Could not delete document from DB' });
        }

        documentPaths.forEach(documentPath => {
            const folderPath = path.join("frontend", path.dirname(documentPath)).split("pdf")[0];
            fs.rmdir(folderPath, { recursive: true }, err => {
                if (err) {
                    console.error("Error when deleting folder", err);
                } else {
                    console.log('Folder deleted successfully');
                }
            });
        });

        await db.query(deleteCaseTagsQuery, [caseId]);

        const deleteCaseResult = await db.query(deleteCaseQuery, [caseId]);
        if (deleteCaseResult.rowCount === 0) {
            return res.status(500).json({ status: 'error', message: 'Could not delete case' });
        }

        res.status(204).end();
    } catch (err) {
        console.error("Error deleting case:", err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});



router.post("/cases/:case_id/clone", async (req, res) => {
    const caseId = req.params.case_id;
    const userId = req.user.id; 
    const db = getDBInstance(dbcon);

    const caseQuery = `
    SELECT c.case_id, c.title, c.description, c.is_public, c.external_case_url, c.user_id, c.rich_text, c.created_at, c.updated_at,
       ARRAY_AGG(DISTINCT jsonb_build_object('id', dd.id, 'path', dd.path, 'name', dd.name)) AS documents,
       COALESCE(ARRAY_REMOVE(ARRAY_AGG(DISTINCT ct.topic_tag_name), NULL), '{}') AS topic_tags
    FROM cases c
    LEFT JOIN designs_documents dd ON c.case_id = dd.case_id
    LEFT JOIN cases_topic_tags ct ON c.case_id = ct.case_id
    WHERE c.case_id = $1
    GROUP BY c.case_id

    `;

    try {
        const caseResult = await db.query(caseQuery, [caseId]);
        if (caseResult.rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Case not found' });
        }

        const originalCase = caseResult.rows[0];

        const newCaseQuery = `
        INSERT INTO cases (title, description, is_public, external_case_url, user_id, rich_text, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        RETURNING case_id
        `;
        
        const newCaseResult = await db.query(newCaseQuery, [
            originalCase.title,
            originalCase.description,
            originalCase.is_public,
            originalCase.external_case_url,
            userId,
            originalCase.rich_text
        ]);

        const newCaseId = newCaseResult.rows[0].case_id;

        for (const doc of originalCase.documents) {
            if (doc.id && doc.path) {
                const oldRelativePath = doc.path;
                const oldFullPath = path.join('frontend', oldRelativePath);

                const newHash = crypto.randomBytes(16).toString('hex');
                const newDirectory = path.join(pass.uploadPath, newHash, 'pdf');
                const newRelativePath = path.join("assets", "uploads", newHash, 'pdf', path.basename(oldRelativePath));
                const newFullPath = path.join(newDirectory, path.basename(oldRelativePath));

                if (!fs.existsSync(newDirectory)) {
                    fs.mkdirSync(newDirectory, { recursive: true });
                }

                fs.copyFileSync(oldFullPath, newFullPath);

                const insertDocumentQuery = `
                INSERT INTO designs_documents (case_id, path, name)
                VALUES ($1, $2, $3)
                `;
                
                await db.query(insertDocumentQuery, [newCaseId, newRelativePath, doc.name]);
            }
        }

        const topicTags = originalCase.topic_tags;
        if (topicTags && topicTags.length > 0) {
            for (const tagName of topicTags) {
                const insertTopicTagQuery = `
                INSERT INTO cases_topic_tags (case_id, topic_tag_name)
                VALUES ($1, $2)
                `;
                
                await db.query(insertTopicTagQuery, [newCaseId, tagName]);
            }
        }

        res.status(200).json({ 
            status: 'success', 
            newCaseId 
        });

    } catch (err) {
        console.error('Error cloning the case:', err);
        res.status(500).json({ status: 'error', message: 'Error cloning the case' });
    }
});


router.patch("/documents/:documentId", async (req, res) => {
    const documentId = req.params.documentId;
    const { name } = req.body;

    const updateDocumentQuery = `
    UPDATE designs_documents
    SET name = $2
    WHERE id = $1
    `;
    const db = getDBInstance(dbcon);

    try {
        await db.query(updateDocumentQuery, [documentId, name]);
        res.status(200).json({ status: 'success', message: 'Document updated' });
    } catch (err) {
        console.error("Error updating document:", err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});



module.exports = router;
