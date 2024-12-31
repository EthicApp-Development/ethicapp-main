import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth2";
import { Strategy as LocalStrategy } from "passport-local";
import * as UsersHelper from '../../helpers/users-helper.js';

passport.serializeUser( (user, done) => {    
    done(null, user);
});

passport.deserializeUser(async (user, done) => {
    try {
        // Check if user is being deserialized from Google OAuth (has `email`) 
        // or from local (has `mail`)
        const email = user.email || user.mail;

        if (!UsersHelper.isEmailVerified(email)) {
            throw new Error("The user's email account is not verified.");
        }

        // Query the user by email
        const existingUser = await UsersHelper.getUserByEmail(email);

        if (existingUser.length > 0) {
            const foundUser = existingUser[0];
            done(null, foundUser);
        } else if (user.email) {
            // If it's an OAuth (e.g., Google) user and no user 
            // is found, insert a new user
            await UsersHelper.insertNewUser(user.displayName, user.email);
            
            // Query the newly inserted user
            const newUser = await UsersHelper.getUserByEmail(user.email);
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
    ? `http://localhost:${process.env.ETHICAPP_NODE_PORT}/google/callback`
    : `https://${domain_name}/google/callback`;

passport.use(
    new GoogleStrategy({
        clientID:          process.env.GOOGLE_CLIENT_ID,
        clientSecret:      process.env.GOOGLE_CLIENT_SECRET,
        callbackURL:       callbackURL,
        passReqToCallback: true
    },
    (req, accessToken, refreshToken, profile, done) => {
        if (!accessToken) {
            return done(new Error("No access token received"));
        }
        const { id, role } = profile;
        req.session.uid = id;
        req.session.role = role;
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
            // Get the user by email
            const userRecord = await UsersHelper.getUserByEmail(email);

            // Check if the user exists
            if (userRecord.length > 0) {
                const user = userRecord[0];
                const match = await UsersHelper.validatePassword(password, user.pass);

                if (match) {
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