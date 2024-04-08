'use strict';
const {
  Model
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class CreateStagesTable  extends Model {
    static associate(models) {
      
    }
  }
  CreateStagesTable.init({
    number: DataTypes.INTEGER,
    type: DataTypes.CHAR(15),
    anon: DataTypes.BOOLEAN,
    chats: DataTypes.BOOLEAN,
    prev_ans: DataTypes.CHAR(255),
    sesion_id: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'Stage',
    tableName: 'stages',
  });

  class Actor extends Model {
    static associate(models) {
      
    }
  }
  Actor.init({
    name: DataTypes.CHAR(255),
    jorder: DataTypes.BOOLEAN,
    stage_id: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'Actor',
    tableName: 'actors',
  });

  class ActorsSelection extends Model {
    static associate(models) {
      
    }
  }
  ActorsSelection.init({
    description: DataTypes.TEXT,
    orden: DataTypes.INTEGER,
    actor_id: DataTypes.INTEGER,
    user_id: DataTypes.INTEGER,
    stage_id: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'ActorsSelection',
    tableName: 'actors_selections',
  });

  return {
    CreateStagesTable,
    Actor,
    ActorsSelection,
  };
};
