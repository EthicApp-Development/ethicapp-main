'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class responses extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  responses.init({
    uid: DataTypes.INTEGER,
    description: DataTypes.TEXT,
    comment: DataTypes.TEXT,
    stime: DataTypes.DATE,
    responses: DataTypes.JSONB,
    uses: DataTypes.TEXT
  }, {
    sequelize,
    modelName: 'responses',
  });
  return responses;
};