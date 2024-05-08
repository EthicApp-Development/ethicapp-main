'use strict';
const {
  Model
} = require('sequelize');

const bcrypt = require('bcryptjs');

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

  User.prototype.validPassword = function(pass) {
    return bcrypt.compareSync(pass, this.pass);
  };

  // Hook antes de guardar para hashear la contraseña
  User.beforeCreate((User, options) => {
    User.pass = bcrypt.hashSync(User.pass, 10);
  });

  return User
};
