'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('users', [
      {
        name: 'John Doe',
        rut: '12345678-9',
        pass: 'password123',
        pass_confirmation: 'password123',
        mail: 'john@example.com',
        sex: 'M',
        role: 'U',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Jane Smith',
        rut: '98765432-1',
        pass: 'securepass',
        pass_confirmation: 'password',
        mail: 'jane@example.com',
        sex: 'F',
        role: 'A',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Michael Johnson',
        rut: '55443322-0',
        pass: 'mypass',
        pass_confirmation: 'mypass',
        mail: 'michael@example.com',
        sex: 'M',
        role: 'U',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Emily Davis',
        rut: '11223344-5',
        pass: '12345678',
        pass_confirmation: '12345678',
        mail: 'emily@example.com',
        sex: 'F',
        role: 'U',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Chris Wilson',
        rut: '99887766-3',
        pass: 'password',
        pass_confirmation: 'contrasena',
        mail: 'chris@example.com',
        sex: 'M',
        role: 'U',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('users', null, {});
  }
};
