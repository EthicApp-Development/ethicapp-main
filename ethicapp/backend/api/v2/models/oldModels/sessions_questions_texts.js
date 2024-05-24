'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class SessionQuestionText extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  SessionQuestionText.init({
    session_id: DataTypes.INTEGER,
    title: DataTypes.TEXT,
    content: DataTypes.TEXT
  }, {
    sequelize,
    modelName: 'SessionQuestionText',
    tableName: 'sessions_questions_texts'
  });
  return SessionQuestionText;
};