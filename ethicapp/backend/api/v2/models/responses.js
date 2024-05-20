'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Response extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      Response.belongsTo(models.Phase, { foreignKey: 'phase_id' });
    }
  }
  Response.init({
    user_id: DataTypes.INTEGER,
    content: DataTypes.JSONB,
    type: DataTypes.STRING,
    phase_id: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'Response',//class
    tableName: 'responses'
  });
  return Response;
};