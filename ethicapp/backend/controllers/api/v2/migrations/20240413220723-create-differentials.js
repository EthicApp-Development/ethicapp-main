'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('differentials', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      title: {
        type: Sequelize.TEXT,
        defaultValue: ''
      },
      text_left: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      text_right: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      orden: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      creator: {
        type: Sequelize.INTEGER,
        allowNull: true, 
        references: {
          model: 'users',
          key: 'id'
        }
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
    //await queryInterface.dropTable('differentials');
  }
};