'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Cambia la columna 'type' de CHAR(15) a VARCHAR(15)
    await queryInterface.changeColumn('phases', 'type', {
      type: Sequelize.STRING(15),
      allowNull: false,
      defaultValue: 'regular'
    });
  },

  async down(queryInterface, Sequelize) {
    // Revertir al CHAR(15) original
    await queryInterface.changeColumn('phases', 'type', {
      type: Sequelize.CHAR(15),
      allowNull: false,
      defaultValue: 'regular'
    });
  }
};
