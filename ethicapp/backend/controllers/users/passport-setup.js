import { dbconnString } from "../../config/config.js";
import passport from "passport";
import bcrypt from "bcrypt"; 
import { param, execSQL } from  "../../db/rest-pg-2.js";
import { Strategy as GoogleStrategy } from "passport-google-oauth2";
import { Strategy as LocalStrategy } from "passport-local";

passport.serializeUser( (user, done) => {    
    done(null, user);
});

passport.deserializeUser(async (user, done) => {
    try {
        // Function to query user by email
        const queryUser = async (email) => {
            const sqlParams = [param("plain", email)];
            const dbParams = {
                sql:       "SELECT * FROM users WHERE mail = $1",
                dbcon:     dbconnString,
                sqlParams: sqlParams,
            };

            try {
                const result = await execSQL(dbParams);
                return result;
            } catch (err) {
                console.error("Error querying user:", err);
                throw new Error("Failed to query user");
            }
        };

        // Function to insert a new user
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
                    dbcon:     dbconnString,
                    sqlParams: sqlParams,
                };

                await execSQL(dbParams);  // No need for Promise wrapping
            } catch (err) {
                console.error("Error during user insertion:", err);
                throw new Error("Failed to insert new user");
            }
        };

        // Check if user is being deserialized from Google OAuth (has `email`) or from local (has `mail`)
        const email = user.email || user.mail;

        // Query the user by email
        const existingUser = await queryUser(email);

        if (existingUser.length > 0) {
            const foundUser = existingUser[0];
            done(null, foundUser);
        } else if (user.email) {
            // If it's a Google user and no user is found, insert a new user
            await insertNewUser(user.displayName, user.email);
            
            // Query the newly inserted user
            const newUser = await queryUser(user.email);
            if (newUser.length > 0) {
                done(null, newUser[0]);
            } else {
                done(null, false, { message: "Error creating new user" });
            }
        } else {
            done(null, false, { message: "User not found" });
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
        usernameField: "email",
        passwordField: "password",
    },
    async (email, password, done) => {
        try {
            // Prepare SQL parameters
            const sqlParams = [param("plain", email)];
            const dbParams = {
                sql:       "SELECT * FROM users WHERE mail = $1",
                dbcon:     dbconnString,
                sqlParams: sqlParams
            };

            const result = await execSQL(dbParams);

            // Check if the user exists
            if (result.length > 0) {
                const user = result[0];

                // Compare passwords using bcrypt
                const passwordMatch = await bcrypt.compare(password, user.pass);

                if (passwordMatch) {
                    // If the password matches, return the user
                    return done(null, user);
                } else {
                    // If password doesn't match, return an error message
                    return done(null, false, { message: "Incorrect email or password" });
                }
            } else {
                // If the user is not found in the database
                return done(null, false, { message: "User not found" });
            }

        } catch (err) {
            // Log and return any error during the authentication process
            console.error("Error during authentication:", err);
            return done(err);
        }
    }
));


export default passport;