'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('responses', 'score', {
      type: Sequelize.ARRAY(Sequelize.FLOAT),
      allowNull: false,
      defaultValue: []
    });
  },
  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('responses', 'score');
  }
};