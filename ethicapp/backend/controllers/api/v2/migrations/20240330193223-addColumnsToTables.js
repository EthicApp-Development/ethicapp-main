'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    //create_09.sql
    await queryInterface.addColumn('teams', 'progress', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0
    });    
    //create_11.sql
    await queryInterface.addColumn('selections', 'confidence', {
      type: Sequelize.INTEGER,
      allowNull: true
    });
    //create_12.sql
    await queryInterface.addColumn('sessions', 'options', {
      type: Sequelize.STRING(16),
      allowNull: true 
    });
    //create_16.sql
    await queryInterface.addColumn('questions', 'plugin_data', {
      type: Sequelize.STRING(255),
      allowNull: true
    });
    //create_18.sql
    await queryInterface.addColumn('questions', 'cpid', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'questions',
        key: 'id'
      },
      onUpdate: 'CASCADE', // Optionally, you can specify the update behaviour
      onDelete: 'CASCADE'  // Optionally, you can specify the deletion behaviour
    });
    //create_19.sql
    await queryInterface.addColumn('users', 'lang', {
      type: Sequelize.STRING(10),
      allowNull: false,
      defaultValue: 'spanish'
    });    
    //create_20.sql
    await queryInterface.addConstraint('sessions_users', {
      type: 'unique',
      name: 'no_dup_users',
      fields: ['uid', 'sesid']
    });
    
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropAllTables();
  }
};