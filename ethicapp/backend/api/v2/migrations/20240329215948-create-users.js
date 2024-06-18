'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('users', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      name: {
        type: Sequelize.STRING,
        allowNull:true
      },
      rut: {
        type: Sequelize.STRING,
        allowNull:true
      },
      pass: {
        type: Sequelize.STRING,
        allowNull:true
      },
      pass_confirmation: {
        type: Sequelize.STRING,
        allowNull:true
      },
      mail: {
        type: Sequelize.STRING,
        allowNull:true
      },
      sex: {
        type: Sequelize.CHAR(1)
      },
      role: {
        type: Sequelize.CHAR(1)
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
