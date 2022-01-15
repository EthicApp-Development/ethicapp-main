const passport = require('passport')
let pass = require("../modules/passwords");
var pg = require('pg');
let crypto = require("crypto");



var DB = null;
function getDBInstance(dbcon){
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
function smartArrayConvert(sqlParams) {
    var arr = [];
    for (var i = 0; i < sqlParams.length; i++) {
        var p = sqlParams[i];
        arr.push(p)
    }
    return arr;
}



const GoogleStrategy = require( 'passport-google-oauth2' ).Strategy;

passport.use(new GoogleStrategy({
    clientID: pass.GOOGLE_CLIENT_ID,
    clientSecret: pass.GOOGLE_CLIENT_SECRET,
    callbackURL: "http://localhost:8501/google/callback",
    passReqToCallback: true
  },
  function(request, accessToken, refreshToken, profile, done) { 
        var db = getDBInstance(pass.dbcon);
                var sql = "SELECT * FROM users WHERE mail ='"+profile.email +"' LIMIT 1";
                var qry;
                qry = db.query(sql,(err,res) =>{
                    if(res.rows[0] != null){
                        }
                    else{
                        var sql = "insert into users(rut, pass, name, mail, sex, role) values ($1,$2,$3,$4,$5,'A')";
                        var qry;
                        var passcr = crypto.createHash('md5').update(profile.displayName).digest('hex');
                        var sqlParams = ["11111111-1", passcr, profile.displayName, profile.email, 'O']
                        var sqlarr = smartArrayConvert(sqlParams);
                        qry = db.query(sql, sqlarr);
                        qry.on("end", function () {
                        });
                        qry.on("error", function(err){
                        });
                    }
                    });
      return done(null, profile);
  }
));

passport.serializeUser( (user, done) => { 
    done(null, user)
} )

passport.deserializeUser((user, done) => {
    done (null, user)
}) 