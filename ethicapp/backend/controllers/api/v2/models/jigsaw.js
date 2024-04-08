'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class JigsawRole extends Model {
    static associate(models) {
      // Aquí puedes definir las asociaciones con otros modelos si es necesario
    }
  }
  JigsawRole.init({
    name: DataTypes.STRING(255),
    description: DataTypes.TEXT,
    sesid: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'JigsawRole',
    tableName: 'jigsaw_roles',
  });
  class JigsawUser extends Model {
    static associate(models) {
      // Aquí puedes definir las asociaciones con otros modelos si es necesario
    }
  }
  JigsawUser.init({
    stageid: DataTypes.INTEGER,
    userid: DataTypes.INTEGER,
    roleid: DataTypes.INTEGER,
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