INSERT INTO users(name, rut, pass, mail, sex, role, aprendizaje)
VALUES
(
    'profesor', '16308816-9', md5('profesor'), 'profesor@test', 'M', 'P', 'Reflexivo'
),
(
    'alumno 1', '20884663-9', md5('alumno1'), 'alumno1@test', 'M', 'A', 'Reflexivo'
),
(
    'alumno 2', '22651377-9', md5('alumno2'), 'alumno2@test', 'F', 'A', 'Teorico'
),
(
    'alumno 3', '19994794-k', md5('alumno3'), 'alumno3@test', 'F', 'A', 'Activo'
);
