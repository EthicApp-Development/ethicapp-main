'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class ReportType extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  ReportType.init({
    report_type: DataTypes.TEXT,
    report_description: DataTypes.TEXT
  }, {
    sequelize,
    modelName: 'ReportType',//class
    tableName: 'report_types'
  });
  return ReportType;
};