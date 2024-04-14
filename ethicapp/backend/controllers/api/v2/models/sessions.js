'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class sessions extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  sessions.init({
    name: DataTypes.STRING,
    descr: DataTypes.TEXT,
    status: DataTypes.INTEGER,
    time: DataTypes.DATE,
    code: DataTypes.STRING(6),
    type: DataTypes.STRING(1),
  }, {
    sequelize,
    modelName: 'sessions',
  });
  return sessions;
};