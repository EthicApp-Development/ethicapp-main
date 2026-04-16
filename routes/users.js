"use strict";

let express = require("express");
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");

router.post("/get-my-name", rpg.singleSQL({
    dbcon:      pass.dbcon,
    sql:        "select name, role, lang from users where id = $1",
    sesReqData: ["uid"],
    sqlParams:  [rpg.param("ses", "uid")]
}));

router.post("/update-lang", rpg.singleSQL({
    dbcon:       pass.dbcon,
    sql:         "update users set lang = $1 where id = $2",
    sesReqData:  ["uid"],
    postReqData: ["lang"],
    sqlParams:   [rpg.param("post", "lang"), rpg.param("ses", "uid")]
}));

router.post('/super-login-as', (req, res) => {
  const targetUid = Number(req.body.uid);

  if (
    !req.session ||
    req.session.role !== 'S' ||
    !Number.isInteger(targetUid) ||
    targetUid <= 0
  ) {
    return res.send({ status: 'error' });
  }

  if (req.session.uid === targetUid) {
    return res.send({ status: 'error' });
  }

  req.session.prevUid = req.session.uid;
  req.session.prevRole = req.session.role;

  req.session.impersonating = true;
  req.session.uid = targetUid;
  req.session.role = 'P';
  req.session.ses = null;

  return res.send({ status: 'ok' });
});

function handleSuperLogoutAs(req, res) {
  if (!req.session || !req.session.impersonating) {
    if (req.method === 'GET') {
      return res.redirect('/login');
    }
    return res.send({ status: 'error' });
  }

  const restoreUid = req.session.authUid || req.session.prevUid;
  const restoreRole = req.session.authRole || req.session.prevRole;

  if (!restoreUid || !restoreRole) {
    if (req.method === 'GET') {
      return res.redirect('/login');
    }
    return res.send({ status: 'error' });
  }

  req.session.uid = restoreUid;
  req.session.role = restoreRole;
  req.session.prevUid = null;
  req.session.prevRole = null;
  req.session.impersonating = false;
  req.session.ses = null;

  if (req.method === 'GET') {
    return res.redirect('/super');
  }

  return res.send({ status: 'ok' });
}

router.get('/super-logout-as', handleSuperLogoutAs);
router.post('/super-logout-as', handleSuperLogoutAs);

router.get("/is-super", (req, res) => {
    if(req.session.role == "S" || req.session.prevUid != null){
        res.send({status: "ok"});
    }
    else {
        res.send({status: "error"});
    }
});

module.exports = router;
