'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // await queryInterface.addConstraint('sessions_questions_texts', {
    //   type: 'foreign key',
    //   fields: ['session_id'],
    //   references: {
    //     table: 'sessions',
    //     field: 'id'
    //   },
    //   onDelete: 'CASCADE',
    //   onUpdate: 'CASCADE'
    // });
    await queryInterface.addColumn('questions', 'text_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: null
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropAllTables();
    //
  }
};
