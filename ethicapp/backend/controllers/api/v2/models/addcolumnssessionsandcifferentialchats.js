'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class addColumnSessionAndDiffChats extends Model {
    static associate(models) {
      // Definir la relación con differentials_chats
      addColumnSessionAndDiffChats.belongsTo(models.differentials_chats, {
        foreignKey: 'parent_id',
        as: 'parentChat'
      });

      // Definir la relación con sessions
      addColumnSessionAndDiffChats.belongsTo(models.sessions, {
        foreignKey: 'session_id',
        as: 'session' 
      });
    }
  }
  addColumnSessionAndDiffChats.init({
    ids: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'addColumnSessionAndDiffChats',
  });
  return addColumnSessionAndDiffChats;
};
