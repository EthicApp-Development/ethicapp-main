'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class UserSessionReport extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  UserSessionReport.init({
    user_id: DataTypes.INTEGER,
    session_id: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'UserSessionReport',//class
    tableName: 'user_session_reports' //Table
  });
  return UserSessionReport;
};