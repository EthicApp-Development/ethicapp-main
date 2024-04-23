'use strict';
const {
  Model
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Chatroom extends Model {
    static associate(models) {
      
    }
  }
  Chatroom.init({
    sesion_id: DataTypes.INTEGER,
    stage_id: DataTypes.INTEGER,
    user_id: DataTypes.INTEGER,
    chat: DataTypes.TEXT,
    message: DataTypes.TEXT,
    content: DataTypes.TEXT,
    stime: DataTypes.DATE,
    parent_id: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'Chat',
    tableName: 'chatroom',
  });

  return Chatroom;
};
