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
    tleft: DataTypes.TEXT,
    tright: DataTypes.TEXT,
    orden: DataTypes.INTEGER,
    creator: DataTypes.INTEGER,
    sesid: DataTypes.INTEGER,
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
    uid: DataTypes.INTEGER,
    did: DataTypes.INTEGER,
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
    uid: DataTypes.INTEGER,
    did: DataTypes.INTEGER,
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
