'use strict';
const { Model, DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

module.exports = (sequelize) => {
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
  // Método para comparar la contraseña ingresada con el hash almacenado
  User.prototype.validPassword = function(pass) {
    return bcrypt.compareSync(pass, this.pass);
  };

  // Hook antes de guardar para hashear la contraseña
  User.beforeCreate((user, options) => {
    user.pass = bcrypt.hashSync(user.pass, 10);
  });

  return User
};
