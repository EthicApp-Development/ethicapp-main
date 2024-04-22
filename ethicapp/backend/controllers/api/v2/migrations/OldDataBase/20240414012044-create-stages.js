'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('stages', {
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
        type: Sequelize.CHAR(15),
        allowNull: false
      },
      anon: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      chats: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      prev_ans: {
        type: Sequelize.CHAR(255),
        allowNull: true
      },
      sesion_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'sessions',
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
    await queryInterface.dropAllTables();
    //await queryInterface.dropTable('stages');
  }
};