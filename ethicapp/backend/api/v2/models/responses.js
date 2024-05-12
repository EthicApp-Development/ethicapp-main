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
    uid: DataTypes.INTEGER,
    description: DataTypes.TEXT,
    comment: DataTypes.TEXT,
    stime: DataTypes.DATE,
    content: DataTypes.JSONB,
    uses: DataTypes.TEXT,
    phase_id: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'Response',//class
    tableName: 'responses'
  });
  return Response;
};