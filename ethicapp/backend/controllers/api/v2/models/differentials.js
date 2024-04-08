'use strict';
const {
  Model
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Differential extends Model {
    static associate(models) {
      
    }
  }
  Differential.init({
    title: DataTypes.TEXT,
    text_left: DataTypes.TEXT,
    text_right: DataTypes.TEXT,
    orden: DataTypes.INTEGER,
    creator: DataTypes.INTEGER,
    sesion_id: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'Differential',
    tableName: 'differentials',
  });

  class DifferentialSelection extends Model {
    static associate(models) {
      
    }
  }
  DifferentialSelection.init({
    user_id: DataTypes.INTEGER,
    differential_id: DataTypes.INTEGER,
    sel: DataTypes.INTEGER,
    iteration: DataTypes.INTEGER,
    comment: DataTypes.TEXT,
    stime: DataTypes.DATE,
  }, {
    sequelize,
    modelName: 'DifferentialSelection',
    tableName: 'differentials_selections',
  });

  class DifferentialChat extends Model {
    static associate(models) {
      
    }
  }
  DifferentialChat.init({
    user_id: DataTypes.INTEGER,
    differential_id: DataTypes.INTEGER,
    content: DataTypes.TEXT,
    stime: DataTypes.DATE,
  }, {
    sequelize,
    modelName: 'DifferentialChat',
    tableName: 'differentials_chats',
  });

  return {
    Differential,
    DifferentialSelection,
    DifferentialChat,
  };
};
