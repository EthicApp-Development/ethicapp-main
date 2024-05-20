'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class ChatMessage extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  ChatMessage.init({
    text: DataTypes.TEXT,
    time: DataTypes.DATE,
    creator: DataTypes.INTEGER,
    code: DataTypes.CHAR,
    current_stage: DataTypes.INTEGER,
    message: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'ChatMessage',//class
    tableName: 'chat_messages '
  });
  return ChatMessage;
};