// TODO: Testing
module.exports.verifySession = (req, res, next) => {
    if (req.isAuthenticated()) {
        // console.log(`\n--------> Middleware: verifySession: Authenticated`);
        return next()
    }
    // console.log(`\n--------> Middleware: verifySession: Not authenticated`);
    res.redirect(`/login`)
};

// TODO: Extend to verify user.type (S, P or A)
