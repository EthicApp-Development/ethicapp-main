'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class selections extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  selections.init({
    answer: DataTypes.INTEGER,
    user_id: DataTypes.INTEGER,
    iteration: { type: DataTypes.INTEGER, defaultValue: 1 },
    comment: DataTypes.TEXT,
    question_id: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'selections',
  });
  return selections;
};