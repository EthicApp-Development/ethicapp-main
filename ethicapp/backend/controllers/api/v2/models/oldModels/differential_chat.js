'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class SDChatMessage extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  SDChatMessage.init({
    user_id: DataTypes.INTEGER,
    differential_id: DataTypes.INTEGER,
    content: DataTypes.TEXT,
    stime: DataTypes.DATE
  }, {
    sequelize,
    modelName: 'differentialsChats',
  });
  return SDChatMessage;
};