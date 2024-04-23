'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class ActorSelection extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  ActorSelection.init({
    description: DataTypes.TEXT,
    orden: DataTypes.INTEGER,
    actor_id: DataTypes.INTEGER,
    user_id: DataTypes.INTEGER,
    stage_id: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'actorsSelections',
  });
  return ActorSelection;
};