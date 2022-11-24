// TODO: Testing
module.exports.verifySession = (req, res, next) => {
    if (req.session.uid && req.session.ses){
        next()
    }
    res.status(401).json({ error: 'Acceso denegado' })
}