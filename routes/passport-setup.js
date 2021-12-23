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
        //console.log(p)
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
    //User.findOrCreate({ googleId: profile.id }, function (err, user) {
        //console.log(profile)    
        var db = getDBInstance(pass.dbcon);

                var sql = "SELECT * FROM users WHERE mail ='"+profile.email +"' LIMIT 1";
                console.log(sql)
                var qry;
                qry = db.query(sql,(err,res) =>{
                    if(res.rows[0] != null){
                        console.log("El usuario ya existe")
                        console.log(res.rows[0] )

                        }
                    else{
                        var sql = "insert into users(rut, pass, name, mail, sex, role) values ($1,$2,$3,$4,$5,'A')";
                        var qry;
                        var passcr = crypto.createHash('md5').update(profile.displayName).digest('hex');
                        var sqlParams = ["11111111-1", passcr, profile.displayName, profile.email, 'O']
                        var sqlarr = smartArrayConvert(sqlParams);
                        //console.log("sql")
                        //console.log(sql)
                        //console.log("sqlarr")
                        //console.log(sqlarr)
                        qry = db.query(sql, sqlarr);
                        qry.on("end", function () {
                            console.log("se creo el usuario de google")
                
                            //res.redirect("login?rc=1");
                            // db.end();
                        });
                        qry.on("error", function(err){
                            console.error("[DB Error]: ", err);
                            console.log("F")
                            
                
                        });
                    }
                    });
      return done(null, profile);
  }
));

passport.serializeUser( (user, done) => { 
    //console.log(`\n--------> Serialize User:`)
    //console.log(user)
     // The USER object is the "authenticated user" from the done() in authUser function.
     // serializeUser() will attach this user to "req.session.passport.user.{user}", so that it is tied to the session object for each session.  

    done(null, user)
} )

passport.deserializeUser((user, done) => {
    //console.log("\n--------- Deserialized User:")
    //console.log(user)
    // This is the {user} that was saved in req.session.passport.user.{user} in the serializationUser()
    // deserializeUser will attach this {user} to the "req.user.{user}", so that it can be used anywhere in the App.

    done (null, user)
}) 
