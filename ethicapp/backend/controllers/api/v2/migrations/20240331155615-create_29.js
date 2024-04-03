'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
  await queryInterface.addColumn('differential', 'stageid', {
    type: Sequelize.INTEGER,
    allowNull: true,
    references: {
      model: 'stages',
      key: 'id'
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL'
  });

  await queryInterface.addColumn('differential', 'justify', {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true
  });

  await queryInterface.addColumn('differential', 'num', {
    type: Sequelize.INTEGER,
    allowNull: false,
    defaultValue: 7
  });
  await queryInterface.addColumn('stages', 'options', {
    type: Sequelize.TEXT,
    allowNull: true
  });
  await queryInterface.addColumn('differential', 'word_count', {
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