"use strict";

let express = require("express");
let middleware = require("../validate-session");
let router = express.Router();

router.get("/", (req, res) => {
    console.log(req.session);
    if (req.session.uid) {
        if (req.session.ses && req.session.role != "P")
            res.redirect("seslist");
        else {
            if (req.session.role == "A")
                res.redirect("seslist");
            else if (req.session.role == "P")
                //res.redirect("admin");
                res.redirect("home");
            else if (req.session.role == "I")
                res.redirect("home");
            else if (req.session.role == "S")
                res.redirect("home");
            else
                res.redirect("login");
        }
    }
    else
        res.redirect("login");
});


router.get("/super", middleware.verifySession ,(req,res) => {
    if(req.session.uid && req.session.role == "S"){
        res.render("super");
    }
    else{
        res.redirect("/login");
    }
});

module.exports = router;
