CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO users(name, rut, pass, mail, sex, ROLE, aprendizaje)
VALUES (
    'Profesor', '12312312-3', md5('profesor'), 'profesor@test', 'M', 'P', 'Reflexivo'
);

INSERT INTO users(name, rut, pass, mail, sex, role, aprendizaje)
VALUES (
    'Alumno 1', '12121212-1', md5('alumno1'), 'alumno1@test', 'M', 'A', 'Reflexivo'
);

INSERT INTO users(name, rut, pass, mail, sex, role, aprendizaje)
VALUES(
    'Alumno 2', '11111111-1', md5('alumno2'), 'alumno2@test', 'F', 'A', 'Teorico'
);

INSERT INTO users(name, rut, pass, mail, sex, role, aprendizaje)
VALUES(
    'Alumno 3', '22222222-2',md5('alumno3'), 'alumno3@test', 'F', 'A', 'Activo'
);

INSERT INTO users(name, rut, pass, mail, sex, role, aprendizaje)
VALUES(
    'MEGA CHECK TEST USER', '22222222-2', md5('testuser'), 'checkuser@test', 'F', 'P', 'Reflexivo'
);