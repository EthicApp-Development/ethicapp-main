'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class JigsawRole extends Model {
    static associate(models) {
      
    }
  }
  JigsawRole.init({
    name: DataTypes.STRING(255),
    description: DataTypes.TEXT,
    sesion_id: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'JigsawRole',
    tableName: 'jigsaw_roles',
  });
  class JigsawUser extends Model {
    static associate(models) {
      
    }
  }
  JigsawUser.init({
    stage_id: DataTypes.INTEGER,
    user__id: DataTypes.INTEGER,
    role_id: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'JigsawUser',
    tableName: 'jigsaw_users',
  });
  return {
    JigsawRole,
    JigsawUser
  };
};