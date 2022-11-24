// TODO: Testing
module.exports.verifySession = (req, res, next) => {
    console.log(req.session.uid != null)
    if (req.session.uid != null){
        next()
    } else {
        res.redirect("login");
    }
}

// TODO: Extend to verify user.type (S, P or A)
