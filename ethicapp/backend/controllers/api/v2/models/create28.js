'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class create28 extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  create28.init({
    content: DataTypes.TEXT,
    stime: DataTypes.DATE
  }, {
    sequelize,
    modelName: 'create28',
  });
  return create28;
};