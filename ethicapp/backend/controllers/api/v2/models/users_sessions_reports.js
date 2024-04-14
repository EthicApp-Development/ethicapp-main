'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class users_sessions_reports extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  users_sessions_reports.init({
    user_id: DataTypes.INTEGER,
    sesion_id: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'users_sessions_reports',
  });
  return users_sessions_reports;
};