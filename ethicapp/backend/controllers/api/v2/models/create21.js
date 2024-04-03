'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class create21 extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  create21.init({
    title: DataTypes.TEXT,
    tleft: DataTypes.TEXT,
    tright: DataTypes.TEXT,
    orden: DataTypes.INTEGER,
    creator: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'create21',
  });
  return create21;
};