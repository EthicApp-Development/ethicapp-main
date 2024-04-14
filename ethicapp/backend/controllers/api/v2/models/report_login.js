'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class report_login extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  report_login.init({
    login_date: DataTypes.DATE,
    is_teacher: DataTypes.BOOLEAN,
    count: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'report_login',
  });
  return report_login;
};