'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Response extends Model {
        /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      Response.belongsTo(models.Question, { foreignKey: 'question_id' });
      Response.belongsTo(models.User, { foreignKey: 'user_id' });
    }
  }
  Response.init({
    user_id: DataTypes.INTEGER,
    content: DataTypes.JSONB,
    type: DataTypes.STRING,
    question_id: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'Response',
    tableName: 'responses'
  });
  return Response;
};