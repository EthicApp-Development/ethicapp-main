const { ForbiddenError } = require('@casl/ability');
const { defineAbilitiesFor } = require('../abilities');

function checkAbility(action, subject) {
    return (req, res, next) => {
        const ability = defineAbilitiesFor(req.user);
        try {
            ForbiddenError.from(ability).throwUnlessCan(action, subject);
            next();
        } catch (error) {
            res.status(403).json({ status: 'error', message: error.message });
        }
    };
}

module.exports = checkAbility;
