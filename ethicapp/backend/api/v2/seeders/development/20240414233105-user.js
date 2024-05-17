'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('users', [
      {
        name: 'John Doe',
        rut: '12345678-9',
        pass: 'password123',
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
