// TODO: Testing
module.exports.verifySession = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }
    const apiKey = req.headers['x-api-key'];
    if (apiKey && apiKey === `${process.env.API_VALIDATION_KEY}`) {
        return next();
    }
    res.redirect("/login");
};

// TODO: Extend to verify user.type (S, P or A)