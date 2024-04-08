'use strict';
const {
  Model
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class UserSessionReport extends Model {
    static associate(models) {
      
    }
  }
  UserSessionReport.init({
    user_id: DataTypes.INTEGER,
    sesion_id: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'UserSessionReport',
    tableName: 'users_sessions_reports',
  });

  return UserSessionReport;
};
