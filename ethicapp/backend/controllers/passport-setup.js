import * as pass from "../config/keys-n-secrets.js";
import passport from "passport";
import bcrypt from "bcrypt"; 
import { param, execSQL, singleSQL } from  "../db/rest-pg-2.js";
import { Strategy as GoogleStrategy } from "passport-google-oauth2";
import { Strategy as LocalStrategy } from "passport-local";

passport.serializeUser( (user, done) => {
    done(null, user);
});

passport.deserializeUser(async (req, user, done) => {
    try {
        const queryUser = async (email) => {
            const sqlParams = [param("plain", email)];
            const dbParams = {
                sql:       "SELECT * FROM users WHERE mail = $1",
                dbcon:     pass.dbcon,
                sqlParams: sqlParams,
            };

            return new Promise((resolve, reject) => {
                const executeQuery = singleSQL(dbParams);
                executeQuery(req, {
                    json:   resolve,
                    status: (code) => reject(new Error(`Error with status code: ${code}`)),
                    end:    () => {}
                });
            });
        };

        const insertNewUser = async (displayName, email) => {
            try {
                const saltRounds = 10; 
                const passwordHash = await bcrypt.hash(displayName, saltRounds);
        
                const sqlParams = [
                    param("plain", displayName),
                    param("plain", email),
                    param("plain", passwordHash),
                    param("plain", "11111111-1"),
                    param("plain", "U"), // Undefined gender
                    param("plain", "A"), // Student role
                ];
        
                const dbParams = {
                    sql:       "INSERT INTO users (name, mail, pass, rut, sex, role) VALUES ($1, $2, $3, $4, $5, $6)",
                    dbcon:     pass.dbcon,
                    sqlParams: sqlParams,
                };
        
                return new Promise((resolve, reject) => {
                    const executeInsert = execSQL(dbParams);
                    executeInsert(req, {
                        json:   resolve,
                        status: (code) => reject(new Error(`Insert failed with status code: ${code}`)),
                        end:    () => {}
                    });
                });
            } catch (err) {
                console.error("Error during user insertion:", err);
                throw new Error("Failed to insert new user");
            }
        };

        if (user.email === undefined) {
            const result = await queryUser(user.mail);
            if (result && result.result.length > 0) {
                const localUser = result.result[0];
                req.session.uid = localUser.id;
                req.session.role = localUser.role;
                done(null, localUser);
            } else {
                done(null, false, { message: "User not found" });
            }
        } else {
            const result = await queryUser(user.email);
            if (result && result.result.length > 0) {
                const googleUser = result.result[0];
                req.session.uid = googleUser.id;
                req.session.role = googleUser.role;
                done(null, googleUser);
            } else {
                await insertNewUser(user.displayName, user.email);
                const newUserResult = await queryUser(user.email);

                if (newUserResult && newUserResult.result.length > 0) {
                    const newUser = newUserResult.result[0];
                    req.session.uid = newUser.id;
                    req.session.role = newUser.role;
                    done(null, newUser);
                } else {
                    done(null, false, { message: "Error creating new user" });
                }
            }
        }
    } catch (err) {
        console.error("Error during deserialization:", err);
        done(err);
    }
});

const domain_name = process.env.NODE_ENV === "development" ? 
    "localhost" : process.env.DOMAIN_NAME;
const callbackURL = domain_name === "localhost"
    ? `http://localhost:${process.env.NODE_PORT}/google/callback`
    : `https://${domain_name}/google/callback`;

passport.use(
    new GoogleStrategy({
        clientID:          process.env.GOOGLE_CLIENT_ID,
        clientSecret:      process.env.GOOGLE_CLIENT_SECRET,
        callbackURL:       callbackURL,
        passReqToCallback: true
    },
    (req, accessToken, refreshToken, profile, done) => {
        const { id, role } = profile;  // Destructuración de profile
        req.session.uid = id;
        req.session.role = role;
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
            const sqlParams = [param("plain", email)];  
            const dbParams = {
                sql:       "SELECT * FROM users WHERE mail = $1",
                dbcon:     pass.dbcon,
                sqlParams: sqlParams
            };

            const executeQuery = singleSQL(dbParams);
            const result = await new Promise((resolve, reject) => {
                executeQuery({}, {
                    json:   resolve,
                    status: (code) => reject(new Error(`Error with status code: ${code}`)),
                    end:    () => {}
                });
            });

            if (result.result.length > 0) {
                const user = result.result[0];
                const passwordMatch = await bcrypt.compare(password, user.pass);

                if (passwordMatch) {
                    return done(null, user);
                } else {
                    return done(null, false, { message: "Incorrect email or password" });
                }
            } else {
                return done(null, false, { message: "User not found" });
            }

        } catch (err) {
            console.error("Error during authentication:", err);
            return done(err);
        }
    }
));
