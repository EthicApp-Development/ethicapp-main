'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('teachers_accounts_requests', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      name: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      rut: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      pass: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      mail: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      gender: {
        type: Sequelize.CHAR(1),
        allowNull: false
      },
      institution: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      date: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        allowNull: false
      },
      status: {
        type: Sequelize.CHAR(1),
        allowNull: false
      },
      reject_reason: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      upgrade_flag: {
        type: Sequelize.BOOLEAN,
        allowNull: true,
        defaultValue: false
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
    await queryInterface.dropAllTables();
  }
};