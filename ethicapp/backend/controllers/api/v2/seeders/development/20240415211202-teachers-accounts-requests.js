'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('teachersAccountsRequests', [
      {
        name: 'John Doe',
        rut: '12345678-9',
        pass: 'password123',
        mail: 'john.doe@example.com',
        gender: 'M',
        institution: 'Example University',
        date: new Date(),
        status: 'P',
        reject_reason: '',
        upgrade_flag: false,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Jane Smith',
        rut: '98765432-1',
        pass: 'securepass456',
        mail: 'jane.smith@example.com',
        gender: 'F',
        institution: 'Another University',
        date: new Date(),
        status: 'P',
        reject_reason: '',
        upgrade_flag: false,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Michael Johnson',
        rut: '23456789-0',
        pass: 'strongpassword789',
        mail: 'michael.johnson@example.com',
        gender: 'M',
        institution: 'Yet Another University',
        date: new Date(),
        status: 'P',
        reject_reason: '',
        upgrade_flag: false,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('teachersAccountsRequests', null, {});
  }
};
