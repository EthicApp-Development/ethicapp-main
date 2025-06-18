'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ChatMessage extends Model {
    static associate(models) {
      ChatMessage.belongsTo(models.ChatRoom, { foreignKey: 'chatroom_id', as: 'room' });
      ChatMessage.belongsTo(models.User,     { foreignKey: 'user_id',     as: 'author' });
      ChatMessage.hasMany(models.ChatMessage, { foreignKey: 'parent_id', as: 'replies' });
    }
  }
  ChatMessage.init({
    chatroom_id: DataTypes.INTEGER,
    user_id:     DataTypes.INTEGER,
    content:     DataTypes.TEXT,
    parent_id:   DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'ChatMessage',
    tableName: 'ChatMessages',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    underscored: true
  });
  return ChatMessage;
};
