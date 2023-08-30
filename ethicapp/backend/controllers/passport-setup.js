const passport = require("passport");
let pass = require("../config/keys-n-secrets");
var pg = require("pg");
let crypto = require("crypto");

const GoogleStrategy = require( "passport-google-oauth2" ).Strategy;
const LocalStrategy = require("passport-local").Strategy;
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


passport.serializeUser( (user, done) => {
    done(null, user);
});

passport.deserializeUser(async (req, user, done) => {
    try {
        // Local User
        if (user.email === undefined) {
            var db = getDBInstance(pass.dbcon);
            var sql = `SELECT * FROM users WHERE mail = '${user.mail}'`;

            db.query(sql,(err,res) =>{
                if(err){
                    console.error(err);
                    done(null, false, { message: err });
                }else{
                    if(res.rows.length > 0){
                        var user = res.rows[0];
                        req.session.uid = res.rows[0].id;
                        req.session.role = res.rows[0].role;
                        // req.session.ses = null;
                        done(null, user);
                    }else{
                        done(null, false, { message: "User not found" });
                    }
                }
            });
        }
        // Google User
        else {
            var db = getDBInstance(pass.dbcon);
            var sql = `SELECT * FROM users WHERE mail = '${user.email}'`;

            db.query(sql,(err,res) =>{
                if(err){
                    console.error(err);
                    done(null, false, { message: err });
                }else{
                    if(res.rows.length > 0){
                        req.session.uid = res.rows[0].id;
                        req.session.role = res.rows[0].role;
                        // req.session.ses = null;
                        done(null, res.rows[0]);
                    }else{
                        try {
                            var passcr = crypto.createHash("md5").update(user.displayName).digest("hex");
                            var sql2 = `
                            INSERT INTO users (name, mail, pass, rut, sex, ROLE) 
                            VALUES ('${user.displayName}','${user.email}','${passcr}','11111111-1','O','A')
                            `;
                            db.query(sql2,(err,res) =>{
                                if(err){
                                    console.error(err);
                                    done(null, false, { message: err });
                                }
                            });

                            var sql3 = `SELECT * FROM users WHERE mail = '${user.email}'`;
                            db.query(sql3,(err,res) =>{
                                if(err){
                                    console.error(err);
                                    done(null, false, { message: err });
                                }else{
                                    req.session.uid = res.rows[0].id;
                                    req.session.role = res.rows[0].role;
                                    // req.session.ses = null;
                                    done(null, res.rows[0]);
                                }
                            });
                        } catch (err) {
                            console.error("Error al registrar el usuario", err);
                            done(err);
                        }
                    }
                }
            });
        }
    } catch (err) {
        console.error("Error al buscar el usuario", err);
        done(err);
    }
});


passport.use(
    new GoogleStrategy({
        clientID:          pass.GOOGLE_CLIENT_ID,
        clientSecret:      pass.GOOGLE_CLIENT_SECRET,
        callbackURL:       "http://localhost:8080/google/callback",
        passReqToCallback: true
    },
    (req, accessToken, refreshToken, profile, done) => {
        req.session.uid = profile.id;
        req.session.role = profile.role;
        // req.session.ses = null;
        return done(null, profile);
    })
);

passport.use(new LocalStrategy(
    {
        usernameField: "user",
        passwordField: "pass",
    },
    async (email, password, done) => {
        try {
            var db = getDBInstance(pass.dbcon);
            var sql = `SELECT * FROM users WHERE mail = '${email}'`;

            db.query(sql,(err,res) =>{
                if(err){
                    console.error(err);
                    done(null, false, { message: err });
                }else{
                    if(res.rows.length > 0){
                        var user = res.rows[0];
                        var passcr = crypto.createHash("md5").update(password).digest("hex");
                        if(passcr === user.pass){
                            return done(null, user);
                        }else{
                            return done(null, false, { message: "Incorrect email or password" });
                        }
                    }else{
                        return done(null, false, { message: "User not found" });
                    }
                }
            });
        } catch (err) {
            return done(err);
        }
    }
));
