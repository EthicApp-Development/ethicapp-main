let validateSession = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }
    const apiKey = req.headers["x-api-key"];
    if (apiKey && apiKey === `${process.env.CONTENT_ANALYSIS_API_KEY}`) {
        return next();
    }
    res.redirect("/login");
};

export { validateSession };
