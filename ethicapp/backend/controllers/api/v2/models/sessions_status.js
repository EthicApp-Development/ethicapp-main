'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class sessions_status extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  sessions_status.init({
    sesion_id: DataTypes.INTEGER,
    status: DataTypes.INTEGER,
    stime: DataTypes.DATE
  }, {
    sequelize,
    modelName: 'sessions_status',
  });
  return sessions_status;
};