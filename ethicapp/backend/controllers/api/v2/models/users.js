'use strict';
const {
  Model
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {
      
    }
  }
  User.init({
    name: DataTypes.STRING,
    rut: DataTypes.STRING,
    pass: DataTypes.STRING,
    mail: DataTypes.STRING,
    sex: DataTypes.CHAR(1),
    role: DataTypes.CHAR(1),
  }, {
    sequelize,
    modelName: 'User',
    tableName: 'users', 
  });

  return User
};
