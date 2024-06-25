import { AbilityBuilder, createMongoAbility } from '@casl/ability';

function defineAbilitiesFor(user) {
    const { can, cannot, build } = new AbilityBuilder(createMongoAbility);
    if (user.role === 'P') {
        can('manage', 'all'); // Profesores pueden gestionar todo lo que poseen
    } else if (user.role === 'A') {
        can('manage', 'all'); // Administradores pueden gestionar todo
    } else if (user.role === 'E') {
        cannot('manage', 'all'); // Estudiantes no pueden gestionar nada
    }

    return build();
}

module.exports = { defineAbilitiesFor };
