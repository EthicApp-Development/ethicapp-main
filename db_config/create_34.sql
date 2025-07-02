-- Insertar usuarios de prueba para desarrollo

-- admin
insert into users (name, rut, pass, mail, sex, role)
values ('admin', '11111111-1', md5('admin'), 'admin@admin', 'M', 'S');

-- profesor
insert into users (name, rut, pass, mail, sex, role)
values ('profesor', '11111111-1', md5('profesor'), 'profesor@test', 'M', 'P');

-- alumno1
insert into users (name, rut, pass, mail, sex, role)
values ('alumno1', '11111111-1', md5('alumno1'), 'alumno1@test', 'M', 'A');

-- alumno2
insert into users (name, rut, pass, mail, sex, role)
values ('alumno2', '11111111-1', md5('alumno2'), 'alumno2@test', 'M', 'A');

-- alumno3
insert into users (name, rut, pass, mail, sex, role)
values ('alumno3', '11111111-1', md5('alumno3'), 'alumno3@test', 'M', 'A');
