'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('differentials_selections', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        }
      },
      differential_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'differentials',
          key: 'id'
        }
      },
      sel: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      iteration: {
        type: Sequelize.INTEGER,
        allowNull: true 
      },
      comment: {
        type: Sequelize.TEXT,
        allowNull: true 
      },
      stime: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
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
    //await queryInterface.dropTable('differentials_selections');
  }
};