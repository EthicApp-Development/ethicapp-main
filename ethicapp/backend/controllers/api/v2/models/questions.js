'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class questions extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  questions.init({
    content: DataTypes.TEXT,
    options: DataTypes.TEXT,
    answer: DataTypes.INTEGER,
    comment: DataTypes.TEXT,
    other: DataTypes.TEXT,
    sesion_id: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'questions',
  });
  return questions;
};