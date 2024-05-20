'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class AccountCreationReport extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  AccountCreationReport.init({
    creation_date: DataTypes.DATE,
    is_teacher: DataTypes.BOOLEAN,
    count: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'AccountCreationReport',//class
    tableName: 'account_creation_reports'
  });
  return AccountCreationReport;
};