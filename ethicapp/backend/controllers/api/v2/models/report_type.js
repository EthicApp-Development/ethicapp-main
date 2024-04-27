'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class report_type extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  report_type.init({
    report_type: DataTypes.TEXT,
    report_description: DataTypes.TEXT
  }, {
    sequelize,
    modelName: 'report_type',//class
    tableName: 'report_types'
  });
  return report_type;
};