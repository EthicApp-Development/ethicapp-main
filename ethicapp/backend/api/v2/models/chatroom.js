'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ChatRoom extends Model {
    static associate(models) {
      ChatRoom.hasMany(models.ChatMessage, { foreignKey: 'chatroom_id', as: 'messages' });
    }
  }
  ChatRoom.init({
    session_id: DataTypes.INTEGER,
    phase_id:   DataTypes.INTEGER,
    question_id:DataTypes.INTEGER,
    group_id:   DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'ChatRoom',
    tableName: 'ChatRooms',
    underscored: true
  });
  return ChatRoom;
};
