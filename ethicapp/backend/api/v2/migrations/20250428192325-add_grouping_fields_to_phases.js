'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('phases', 'grouping_algorithm', {
      type: Sequelize.STRING(20),
      allowNull: true
    });
    await queryInterface.addColumn('phases', 'stdnt_amount', {
      type: Sequelize.INTEGER,
      allowNull: true
    });
    await queryInterface.addColumn('phases', 'hetero_question_index', {
      type: Sequelize.INTEGER,
      allowNull: true
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('phases', 'grouping_algorithm');
    await queryInterface.removeColumn('phases', 'stdnt_amount');
    await queryInterface.removeColumn('phases', 'hetero_question_index');
  }
};
