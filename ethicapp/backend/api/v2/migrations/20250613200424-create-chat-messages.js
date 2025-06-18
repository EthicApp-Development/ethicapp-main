'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('ChatMessages', {
      id: {
        type: Sequelize.INTEGER, 
        primaryKey: true, 
        autoIncrement: true
      },
      chatroom_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'ChatRooms', key: 'id' },
        onDelete: 'CASCADE'
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE'
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      parent_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'ChatMessages', key: 'id' },
        onDelete: 'SET NULL'
      },
      created_at: {
        type: Sequelize.DATE, 
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()')
      }
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('ChatMessages');
  }
};
