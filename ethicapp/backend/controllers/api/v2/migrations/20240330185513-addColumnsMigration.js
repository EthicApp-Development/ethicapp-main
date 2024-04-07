'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('teams', 'original_leader', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    });
    await queryInterface.addColumn('documents', 'active', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true
    });    
    // Asegúrate de crear el índice para la clave externa después de añadir la columna
    await queryInterface.addConstraint('teams', {
      type: 'foreign key',
      fields: ['original_leader'],
      references: {
        table: 'users',
        field: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropAllTables();
  }
};