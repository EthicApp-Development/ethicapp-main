'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addConstraint('user_sessions_reports', {
      type: 'foreign key',
      fields: ['user_id'],
      references: {
        table: 'users',
        field: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });
    await queryInterface.addConstraint('user_sessions_reports', {
      type: 'foreign key',
      fields: ['sesion_id'],
      references: {
        table: 'sessions',
        field: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });
    await queryInterface.addColumn('users', 'aprendizaje', {
      type: Sequelize.ENUM('Reflexivo', 'Activo', 'Teorico', 'Pragmatico')
    });
    await queryInterface.addColumn('teams', 'leader', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    });
    // Asegúrate de crear el índice para la clave externa después de añadir la columna
    await queryInterface.addConstraint('teams', {
      type: 'foreign key',
      fields: ['leader'],
      references: {
        table: 'users',
        field: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });  
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropAllTables();
    //
  }
};
