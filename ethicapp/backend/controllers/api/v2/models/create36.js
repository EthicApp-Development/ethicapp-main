'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class create36 extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  create36.init({
    path: DataTypes.TEXT,
    dsgnid: DataTypes.INTEGER,
    uploader: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'create36',
  });
  return create36;
};