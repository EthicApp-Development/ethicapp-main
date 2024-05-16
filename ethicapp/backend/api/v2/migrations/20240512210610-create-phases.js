'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('phases', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      number: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      type: {
        type: Sequelize.CHAR,
        allowNull: false
      },
      anon: {
        type: Sequelize.BOOLEAN,
        allowNull: false
      },
      chat: {
        type: Sequelize.BOOLEAN,
        allowNull: false
      },
      prev_ans: {
        type: Sequelize.CHAR,
        allowNull: false
      },
      activity_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'activities',
          key: 'id'
        }
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },
  async down(queryInterface, Sequelize) {
    //await queryInterface.dropTable('Phases');
    await queryInterface.dropAllTables();
  }
};