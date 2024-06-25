'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('questions', 'phase_id', {
      type: Sequelize.INTEGER,
      allowNull: true, //if it is set to false it will be in a loop, if it is executed the seeds
      references: {
        model: 'phases',
        key: 'id'
      }
    });
    await queryInterface.addColumn('questions', 'number', {
      type: Sequelize.INTEGER,
      allowNull: false
    });
    // await queryInterface.addConstraint('questions', {
    //   fields: ['phases_id', 'number_phase'],
    //   type: 'unique',
    //   name: 'unique_question_phase'
    // });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropAllTables();
  }
};
