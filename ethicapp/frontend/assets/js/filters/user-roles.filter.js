export const userRolesFilter = function($translate) {
    return function(input) {
        if (!input) return input;

        // Mapeo de letras a claves de traducción
        const roleMap = {
            'A': 'role_student',
            'P': 'role_teacher',
        };

        // Obtén la clave de traducción basada en la entrada
        const translationKey = roleMap[input];

        // Si no hay una clave válida, devuelve la entrada original
        if (!translationKey) return input;

        // Usa $translate para traducir la clave
        return $translate.instant(translationKey);
    };
};