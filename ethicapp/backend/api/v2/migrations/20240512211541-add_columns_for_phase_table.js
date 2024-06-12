'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('phases', 'question', {
      type: Sequelize.TEXT,
      allowNull: true
    });
    await queryInterface.addColumn('phases', 'grouping', {
      type: Sequelize.STRING(63), 
      allowNull: true
    });
    await queryInterface.addColumn('phases', 'options', {
      type: Sequelize.TEXT,
      allowNull: true
    });
    await queryInterface.addColumn('responses', 'question_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'questions',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL' 
    });
    await queryInterface.addColumn('sessions', 'current_phases', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'phases',
        key: 'id'
      }
    });
    await queryInterface.addColumn('teams', 'phases_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'phases',
        key: 'id'
      }
    });

    // await queryInterface.addConstraint('phases', {
    //   fields: ['activity_id', 'number'],
    //   type: 'unique',
    //   name: 'unique_activity_phase'
    // });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropAllTables();
  }
};
