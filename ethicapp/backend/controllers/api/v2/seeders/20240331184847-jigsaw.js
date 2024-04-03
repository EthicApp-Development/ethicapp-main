'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.bulkInsert('jigsaw_role', [
      {
        id: 1,
        name: 'Role 1',
        description: 'Description for Role 1',
        sesid: 1, // Adjust this value according to your session id
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 2,
        name: 'Role 2',
        description: 'Description for Role 2',
        sesid: 1, // Adjust this value according to your session id
        createdAt: new Date(),
        updatedAt: new Date()
      },
      // Add more rows as needed
    ], {});
    await queryInterface.bulkInsert('jigsaw_users', [
      {
        stageid: 1, // Adjust this value according to your stage id
        userid: 1, // Adjust this value according to your user id
        roleid: 1, // Adjust this value according to your role id
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        stageid: 2, // Adjust this value according to your stage id
        userid: 2, // Adjust this value according to your user id
        roleid: 2, // Adjust this value according to your role id
        createdAt: new Date(),
        updatedAt: new Date()
      },
      // Add more rows as needed
    ], {});
    await queryInterface.addColumn('sesusers','device',{
      type: Sequelize.STRING(255),
      allowNull: true
    })
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('jigsaw_role', null, {});
    await queryInterface.bulkDelete('jigsaw_users', null, {});
  }
};
