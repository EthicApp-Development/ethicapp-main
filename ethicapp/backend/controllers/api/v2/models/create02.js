'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class create02 extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  create02.init({
    content: DataTypes.TEXT,
    example: DataTypes.BOOLEAN,
    uid: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'create02',
  });
  return create02;
};