'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class ActivityUserRole extends Model {
    static associate(models) {
      ActivityUserRole.belongsTo(models.User, {
        foreignKey: 'userId',
        as: 'user'
      });
      ActivityUserRole.belongsTo(models.ActivityRole, {
        foreignKey: 'RoleId',
        as: 'role'
      });
      ActivityUserRole.belongsTo(models.Activity, {
        foreignKey: 'activityId',
        as: 'activity'
      });
    }
  }
  ActivityUserRole.init({
    userId: DataTypes.INTEGER,
    RoleId: DataTypes.INTEGER,
    activityId: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'ActivityUserRole',
    tableName: 'activityUserRoles'
  });
  return ActivityUserRole;
};
