'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class ActivityRole extends Model {
    static associate(models) {
      ActivityRole.belongsTo(models.Activity, {
        foreignKey: 'ActivityId',
        as: 'activity'
      });
      ActivityRole.hasMany(models.ActivityUserRole, {
        foreignKey: 'RoleId',
        as: 'userAssignments'
      });
      ActivityRole.belongsToMany(models.User, {
        through: models.ActivityUserRole,
        foreignKey: 'RoleId',
        otherKey: 'userId',
        as: 'users'
      });
    }
  }
  ActivityRole.init({
    nombre: DataTypes.STRING(255),
    descripcion: DataTypes.TEXT,
    ActivityId: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'ActivityRole',
    tableName: 'activityRoles'
  });
  return ActivityRole;
};
