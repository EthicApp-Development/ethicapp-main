'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('groups', 'user_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    });
    // await queryInterface.addColumn('designs', 'questions_id', {
    //   type: Sequelize.INTEGER,
    //   allowNull: true,
    //   references: {
    //     model: 'questions',
    //     key: 'id'
    //   }
    // });
    await queryInterface.addColumn('questions', 'designs_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'designs',
        key: 'id'
      }
    });
    await queryInterface.addColumn('sessions', 'state', {
      type: Sequelize.ENUM('new', 'active', 'finished')
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropAllTables();
  }
};
