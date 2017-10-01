"use strict";

let express = require('express');
let router = express.Router();

router.get('/', (req, res) => {
    if (req.session.uid) {
        if (req.session.ses && req.session.role != "P")
            res.redirect("visor");
        else {
            if (req.session.role == "A")
                res.redirect("seslist");
            else if (req.session.role == "P")
                res.redirect("admin");
            else if (req.session.role == "S")
                res.redirect("super");
            else
                res.redirect("login");
        }
    }
    else
        res.redirect("login");
});


router.get("/super", (req,res) => {
    if(req.session.uid && req.session.role == "S"){
        res.render("super");
    }
    else{
        res.redirect("/login");
    }
});

module.exports = router;
