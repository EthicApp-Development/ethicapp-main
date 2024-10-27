router.post("/upload-file", (req, res) => {
    if (
        req.session.uid != null && req.body.title != null && req.body.title != "" &&
        req.files.pdf != null && req.files.pdf.mimetype == "application/pdf" &&
        req.body.sesid != null
    ) {
        rpg.execSQL({
            dbcon: pass.dbcon,
            sql:   `
            INSERT INTO documents(title, PATH, sesid, uploader)
            VALUES ($1,$2,$3,$4)
            `,
            sqlParams: [
                rpg.param("post", "title"), rpg.param("calc", "path"),
                rpg.param("post", "sesid"), rpg.param("ses", "uid")
            ],
            onStart: (ses, data, calc) => {
                calc.path = "uploads" + req.files.pdf.file.split("uploads")[1];
            },
            onEnd: () => {
            }
        })(req, res);
        res.end('{"status":"ok"}');
    }
    res.end('{"status":"err"}');
});

router.post("/upload-design-file", (req, res) => {
    if (
        req.session.uid != null  && req.files.pdf != null
        && req.files.pdf.mimetype == "application/pdf"
    ) {
        rpg.execSQL({
            dbcon: pass.dbcon,
            sql:   `
            INSERT INTO designs_documents(PATH, dsgnid, uploader)
            VALUES ($1,$2,$3)
            `,
            sqlParams: [
                rpg.param("calc", "path"), rpg.param("post", "dsgnid"), rpg.param("ses", "uid")
            ],
            onStart: (ses, data, calc) => {
                calc.path = "assets/uploads" + req.files.pdf.file.split("uploads")[1];
            },
            onEnd: () => {
            }
        })(req, res);
        res.end('{"status":"ok"}');
    }
    res.end('{"status":"err"}');
});


router.post("/delete-design-document", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE designs_documents
    SET active = FALSE
    WHERE id = $1
    `,
    postReqData: ["dsgnid"],
    sqlParams:   [rpg.param("post", "dsgnid")]
}));

router.post("/upload-design", (req, res) => {
    var id = req.session.uid;
    var sql = `
    INSERT INTO DESIGNS(creator, design)
    VALUES (${id}, '${JSON.stringify(req.body)}')
    `;
    var sql2 = "SELECT max(id) FROM DESIGNS WHERE creator = "+id;
    var db = getDBInstance(pass.dbcon);
    var qry;
    var qry2;
    var result;
    qry = db.query(sql);
    qry.on("end", function () {
        qry2 = db.query(sql2,(err,res) =>{
            if(res!= null){
                result = res.rows[0].max;
            }
        });
        qry2.on("end", function () {
            res.end('{"status":"ok", "id":'+result+"}");   
        });
            
    });
    qry.on("error", function(err){
        console.error(err);
        res.end('{"status":"err"}');
    });
});

router.post("/get-design", (req, res) => {
    // var uid = req.session.uid;
    var id = req.body;
    var sql = `
    SELECT *
    FROM DESIGNS
    WHERE id = ${id}
    `;
    var db = getDBInstance(pass.dbcon);
    var qry;
    var result;
    qry = db.query(sql,(err,res) =>{
        if(res != null){
            result = JSON.stringify(res.rows[0].design);   
        }
    });
    qry.on("end", function () {
        res.end('{"status":"ok", "result":'+result+"}");
    });
    qry.on("error", function(err){
        console.error(`Fatal error on the SQL query "${sql}"`);
        console.error(err);
        res.end('{"status":"err"}');
    });
});

router.get("/get-user-designs", (req, res) => {
    var uid = req.session.uid;
    var sql = `
    SELECT *
    FROM DESIGNS
    WHERE creator = ${uid}
    ORDER BY id DESC;
    `;
    var db = getDBInstance(pass.dbcon);
    var qry;
    var result = [];
    qry = db.query(sql,(err,res) =>{
        if(res != null){
            for (let i=0; i<res.rows.length;i++) result.push(res.rows[i].design);
            for (let i=0; i<result.length;i++) result[i].id= res.rows[i].id; //add id to to design
            for (let i=0; i<result.length;i++) result[i].public= res.rows[i].public; //add id to to design
            for (let i=0; i<result.length;i++) result[i].locked= res.rows[i].locked; //add id to to design
        }
    });
    qry.on("end", function () {
        res.json({"status": "ok", "result": result});
    });
    qry.on("error", function(err){
        console.error(`Fatal error on the SQL query "${sql}"`);
        console.error(err);
        res.end('{"status":"err"}');
    });
});

router.get("/get-public-designs", (req, res) => {
    var uid = req.session.uid;
    var sql = `
    SELECT *
    FROM DESIGNS
    WHERE public = true
        AND creator != ${uid}
    ORDER BY id DESC;
    `;
    var db = getDBInstance(pass.dbcon);
    var qry;
    var result = [];
    qry = db.query(sql,(err,res) =>{
        if(res != null){
            for (let i=0; i<res.rows.length;i++) result.push(res.rows[i].design);
            for (let i=0; i<result.length;i++) result[i].id= res.rows[i].id; //add id to to design
        }
    });
    qry.on("end", function () {
        res.json({"status": "ok", "result": result});
    });
    qry.on("error", function(err){
        console.error(`Fatal error on the SQL query "${sql}"`);
        console.error(err);
        res.end('{"status":"err"}');
    });
});

router.post("/design-public", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE DESIGNS
    SET PUBLIC = NOT PUBLIC
    WHERE id = $1;
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "dsgnid")]
}));

router.post("/design-lock", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE DESIGNS
    SET locked = NOT locked
    WHERE id = $1;
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "dsgnid")]
}));

router.post("/update-design", (req, res) => {
    var uid = req.session.uid;
    var id = req.body.id;
    var sql = `
    UPDATE DESIGNS
    SET design = '${JSON.stringify(req.body.design)}'
    WHERE creator = ${uid}
        AND id = ${id}
    `;
    var db = getDBInstance(pass.dbcon);
    var qry;
    qry = db.query(sql);
    qry.on("end", function () {
        res.end('{"status":"ok"}');
    });
    qry.on("error", function(err){
        console.error(`Fatal error on the SQL query "${sql}"`);
        console.error(err);
        res.end('{"status":"err"}');
    });
});

router.post("/delete-design", (req, res) => {
    var uid = req.session.uid;
    var id = req.body.id;
    var sql = `
    DELETE FROM DESIGNS
    WHERE creator = ${uid}
        AND id = ${id}
    `;
    var db = getDBInstance(pass.dbcon);
    var qry;
    qry = db.query(sql);
    qry.on("end", function () {
        res.end('{"status":"ok"}');
    });
    qry.on("error", function(err){
        console.error(`Fatal error on the SQL query "${sql}"`);
        console.error(err);
        res.end('{"status":"err"}');
    });
});

router.post("/designs-documents", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        PATH
    FROM designs_documents
    WHERE dsgnid = $1
        AND active = TRUE
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "dsgnid")]
}));

router.post("/documents-session", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        title,
        PATH
    FROM documents
    WHERE sesid = $1
        AND active = TRUE
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));

router.post("/questions-session", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        content,
        OPTIONS,
        answer,
        COMMENT,
        other,
        textid,
        plugin_data
    FROM questions
    WHERE sesid = $1
    ORDER BY id ASC
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));

router.post("/get-question-text", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        title,
        content
    FROM question_text
    WHERE sesid = $1
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));
