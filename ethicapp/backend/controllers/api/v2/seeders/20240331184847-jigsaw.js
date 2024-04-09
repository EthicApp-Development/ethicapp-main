'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.bulkInsert('jigsaw_roles', [
      {
        id: 1,
        name: 'Role 1',
        description: 'Description for Role 1',
        sesion_id: 1, // Adjust this value according to your session id
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: 2,
        name: 'Role 2',
        description: 'Description for Role 2',
        sesion_id: 1, // Adjust this value according to your session id
        created_at: new Date(),
        updated_at: new Date()
      },
      // Add more rows as needed
    ], {});
    await queryInterface.bulkInsert('jigsaw_users', [
      {
        stage_id: 1, // Adjust this value according to your stage id
        user__id: 1, // Adjust this value according to your user id
        role_id: 1, // Adjust this value according to your role id
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        stage_id: 2, // Adjust this value according to your stage id
        user__id: 2, // Adjust this value according to your user id
        role_id: 2, // Adjust this value according to your role id
        created_at: new Date(),
        updated_at: new Date()
      },
      // Add more rows as needed
    ], {});
    await queryInterface.addColumn('sessions_users','device',{
      type: Sequelize.STRING(255),
      allowNull: true
    })
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('jigsaw_roles', null, {});
    await queryInterface.bulkDelete('jigsaw_users', null, {});
  }
};
