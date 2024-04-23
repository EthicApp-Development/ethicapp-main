'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class jigsawRole extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  jigsawRole.init({
    name: DataTypes.STRING(255),
    description: DataTypes.TEXT,
    sesion_id: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'jigsawRoles',
  });
  return jigsawRole;
};