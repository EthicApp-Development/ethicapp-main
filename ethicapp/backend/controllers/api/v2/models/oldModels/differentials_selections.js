'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class differentialsSelections extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  differentialsSelections.init({
    user_id: DataTypes.INTEGER,
    differential_id: DataTypes.INTEGER,
    sel: DataTypes.INTEGER,
    iteration: DataTypes.INTEGER,
    comment: DataTypes.TEXT,
    stime: DataTypes.DATE,
  }, {
    sequelize,
    modelName: 'differentialsSelections',
  });
  return differentialsSelections;
};