'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('phases', 'status', {
      type:  Sequelize.ENUM('inprogress', 'done'),
      allowNull: false,
      defaultValue: 'inprogress'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('phases', 'status');
  }
};

