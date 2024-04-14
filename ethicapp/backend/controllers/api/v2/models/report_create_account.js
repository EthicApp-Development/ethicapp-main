'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class report_create_account extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  report_create_account.init({
    creation_date: DataTypes.DATE,
    is_teacher: DataTypes.BOOLEAN,
    count: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'report_create_account',
  });
  return report_create_account;
};