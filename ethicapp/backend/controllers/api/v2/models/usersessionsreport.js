'use strict';
const {
  Model
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class UserSessionReport extends Model {
    static associate(models) {
      // Aquí puedes definir las asociaciones con otros modelos si es necesario
    }
  }
  UserSessionReport.init({
    uid: DataTypes.INTEGER,
    sesid: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'UserSessionReport',
    tableName: 'users_session_reports',
  });

  return UserSessionReport;
};
