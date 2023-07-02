// TODO: Testing
module.exports.verifySession = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect("/login");
};

// TODO: Extend to verify user.type (S, P or A)