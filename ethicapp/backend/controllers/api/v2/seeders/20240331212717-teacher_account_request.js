'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.bulkInsert('teacher_account_requests', [
      {
        name: 'Nombre del Solicitante 1',
        rut: '11111111-1',
        pass: 'contraseña1',
        mail: 'solicitante1@example.com',
        gender: 'M', // M para masculino, F para femenino, O para otro, etc.
        institution: 'Institución 1',
        date: new Date(), // La fecha actual
        status: 'P', // P para pendiente, A para aprobado, R para rechazado, etc.
        reject_reason: '', // Razón del rechazo, si aplica
        upgrade_flag: false, // Si ha solicitado un upgrade
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Nombre del Solicitante 2',
        rut: '22222222-2',
        pass: 'contraseña2',
        mail: 'solicitante2@example.com',
        gender: 'F', // M para masculino, F para femenino, O para otro, etc.
        institution: 'Institución 2',
        date: new Date(), // La fecha actual
        status: 'P', // P para pendiente, A para aprobado, R para rechazado, etc.
        reject_reason: '', // Razón del rechazo, si aplica
        upgrade_flag: true, // Si ha solicitado un upgrade
        createdAt: new Date(),
        updatedAt: new Date()
      },
      // Agrega más datos según sea necesario
    ], {});
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('teacher_account_requests', null, {});
  }
};
