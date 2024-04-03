'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class create37 extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  create37.init({
    name: DataTypes.TEXT,
    rut: DataTypes.TEXT,
    pass: DataTypes.TEXT,
    mail: DataTypes.TEXT,
    gender: DataTypes.STRING,
    institution: DataTypes.TEXT,
    date: DataTypes.DATE,
    status: DataTypes.STRING,
    reject_reason: DataTypes.TEXT,
    upgrade_flag: DataTypes.BOOLEAN
  }, {
    sequelize,
    modelName: 'create37',
  });
  return create37;
};