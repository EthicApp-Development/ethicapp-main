'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('sessions', 'current_stage', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'stages',
        key: 'id'
      }
    });
    await queryInterface.addColumn('teams', 'stage_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'stages',
        key: 'id'
      }
    });
    // await queryInterface.addColumn('actors_selections', 'stime', {
    //   type: Sequelize.DATE,
    //   allowNull: false,
    //   defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
    // });
    // await queryInterface.addColumn('actors', 'justified', {
    //   type: Sequelize.BOOLEAN,
    //   allowNull: false,
    //   defaultValue: true
    // });
    await queryInterface.addColumn('stages', 'question', {
      type: Sequelize.TEXT,
      allowNull: true
    });
    await queryInterface.addColumn('stages', 'grouping', {
      type: Sequelize.STRING(63), 
      allowNull: true
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropAllTables();
    //
  }
};
