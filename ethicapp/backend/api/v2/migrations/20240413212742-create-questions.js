'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('questions', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      content: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      additional_info:{
        type: Sequelize.TEXT,
      },
      type: {
        type: Sequelize.STRING(255)
      },
      text: {
        type: Sequelize.TEXT
      },
      // options: {
      //   type: Sequelize.TEXT,
      //   allowNull: true
      // },
      // answer: {
      //   type: Sequelize.INTEGER,
      //   allowNull: true
      // },
      // comment: {
      //   type: Sequelize.TEXT,
      //   allowNull: true
      // },
      // other: {
      //   type: Sequelize.TEXT,
      //   allowNull: true
      // },      
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
    //await queryInterface.dropTable('questions');
  }
};