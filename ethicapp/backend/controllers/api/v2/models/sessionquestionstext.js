'use strict';
const {
  Model
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class SessionQuestionsText extends Model {
    static associate(models) {
      
    }
  }
  SessionQuestionsText.init({
    sesid: DataTypes.INTEGER,
    title: DataTypes.TEXT,
    content: DataTypes.TEXT
  }, {
    sequelize,
    modelName: 'SessionQuestionsText',
    tableName: 'sessions_questions_texts'
  });

  // Agregar la columna textid a la tabla questions
  SessionQuestionsText.associate = function(models) {
    models.create05.hasOne(models.SessionQuestionsText, { foreignKey: 'textid' });
  };

  return SessionQuestionsText;
};
