'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Question extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  Question.init({
    content: DataTypes.JSONB,
    additional_info: DataTypes.TEXT,
    type: DataTypes.STRING,
    text: DataTypes.TEXT,
    // options: DataTypes.TEXT,
    // answer: DataTypes.INTEGER,
    // comment: DataTypes.TEXT,
    // other: DataTypes.TEXT,
    session_id: DataTypes.INTEGER,
    phases_id:DataTypes.INTEGER,
    number_phase: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'Question',//class
    tableName: 'questions'
  });
  return Question;
};