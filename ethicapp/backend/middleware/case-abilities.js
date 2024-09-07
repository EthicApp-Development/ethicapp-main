const { AbilityBuilder, createMongoAbility, ForbiddenError } = require('@casl/ability');


// Definición de las habilidades según el rol del usuario
function defineAbilitiesForCasesAndTags(user) {
    const { can, cannot, build } = new AbilityBuilder(createMongoAbility);

    switch (user.role) {
        case 'S':
            // Superadministrador
            can('list', 'Case');
            can('read', 'Case');
            can('create', 'Case');
            can('update', 'Case');
            can('delete', 'Case');

            
            can('read', 'Tag');
            can('create', 'Tag');
            can('update', 'Tag');
            can('delete', 'Tag');
            break;

        case 'P':
            // Profesor
            can('read', 'Case', { $or: [{ user_id: user.id }, { is_public: true }] });
            can('create', 'Case');
            can('update', 'Case', { user_id: user.id, 'designs.locked': false });
            can('delete', 'Case', { user_id: user.id, 'designs.locked': false });

            can('read', 'Tag', { user_id: user.id });
            can('create', 'Tag');
            cannot('update', 'Tag');
            cannot('delete', 'Tag');
            break;

        case 'A':
            // Alumno
            can('read', 'Case', { is_public: true });
            cannot('create', 'Case');
            cannot('update', 'Case');
            cannot('delete', 'Case');

            can('read', 'Tag');
            cannot('create', 'Tag');
            cannot('update', 'Tag');
            cannot('delete', 'Tag');
            break;

        default:
            cannot('read', 'Case');
            cannot('create', 'Case');
            cannot('update', 'Case');
            cannot('delete', 'Case');
            cannot('read', 'Tag');
            cannot('create', 'Tag');
            cannot('update', 'Tag');
            cannot('delete', 'Tag');
    }

    return build();
}



function authorize(action, subject, caseData) {
    return (req, res, next) => {
        const ability = defineAbilitiesForCasesAndTags(req.user);
        try {
            if (caseData) {
                ForbiddenError.from(ability).throwUnlessCan(action, subject, caseData);
            } else {
                ForbiddenError.from(ability).throwUnlessCan(action, subject);
            }
            next();
        } catch (error) {
            res.status(403).json({ status: 'error', message: 'Unauthorized action' });
        }
    };
}


module.exports = authorize;
