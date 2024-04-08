'use strict';
const {
  Model
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Chat extends Model {
    static associate(models) {
      
    }
  }
  Chat.init({
    sesid: DataTypes.INTEGER,
    stageid: DataTypes.INTEGER,
    uid: DataTypes.INTEGER,
    content: DataTypes.TEXT,
    stime: DataTypes.DATE,
    parent_id: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'Chat',
    tableName: 'chats',
  });

  return Chat;
};
