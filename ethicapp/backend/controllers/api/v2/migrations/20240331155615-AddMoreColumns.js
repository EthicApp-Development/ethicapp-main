'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
  await queryInterface.addColumn('differentials', 'stage_id', {
    type: Sequelize.INTEGER,
    allowNull: true,
    references: {
      model: 'stages',
      key: 'id'
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL'
  });

  await queryInterface.addColumn('differentials', 'justify', {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true
  });

  await queryInterface.addColumn('differentials', 'num', {
    type: Sequelize.INTEGER,
    allowNull: false,
    defaultValue: 7
  });
  await queryInterface.addColumn('stages', 'options', {
    type: Sequelize.TEXT,
    allowNull: true
  });
  await queryInterface.addColumn('differentials', 'word_count', {
    type: Sequelize.INTEGER,
    allowNull: false,
    defaultValue: 0
  });
  await queryInterface.addColumn('actors', 'word_count', {
    type: Sequelize.INTEGER,
    allowNull: false,
    defaultValue: 0
  });

  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropAllTables();
  }
};