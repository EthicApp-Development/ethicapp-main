'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class SemanticDifferentialItem extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  SemanticDifferentialItem.init({
    title: DataTypes.TEXT,
    text_left: DataTypes.TEXT,
    text_right: DataTypes.TEXT,
    orden: DataTypes.INTEGER,
    creator: DataTypes.INTEGER,
    session_id: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'SemanticDifferentialItem',
    tableName: 'differentials'
  });
  return SemanticDifferentialItem;
};