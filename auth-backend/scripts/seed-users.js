import 'dotenv/config';

import { spawnSync } from 'node:child_process';

function createUser(args) {
  const result = spawnSync(
    'node',
    ['scripts/create-user.js', ...args],
    { stdio: 'inherit' }
  );

  if (result.status !== 0) {
    console.error('❌ Error creando usuario:', args[2]);
    process.exit(1);
  }
}

function main() {
  console.log('🌱 Creando usuarios de prueba...');

  // Profesor
  createUser([
    'Profesor',
    'Demo',
    'profesor@test',
    'profesor123!!',
    'P'
  ]);

  // Alumnos
  createUser([
    'Alumno Uno',
    'Demo',
    'alumno1@test',
    'alumno123!!',
    'A'
  ]);

  createUser([
    'Alumno Dos',
    'Demo',
    'alumno2@test',
    'alumno123!!',
    'A'
  ]);

  createUser([
    'Alumno Tres',
    'Demo',
    'alumno3@test',
    'alumno123!!',
    'A'
  ]);

  console.log('✔ Usuarios de prueba creados');
}

main();
