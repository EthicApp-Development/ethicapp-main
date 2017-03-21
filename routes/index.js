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
            else
                res.redirect("admin");
        }
    }
    else
        res.redirect("login");
});

module.exports = router;
