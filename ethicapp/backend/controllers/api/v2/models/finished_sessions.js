'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class finished_sessions extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  finished_sessions.init({
    user_id: DataTypes.INTEGER,
    session_id: DataTypes.INTEGER,
    status: DataTypes.INTEGER,
    stime: DataTypes.DATE
  }, {
    sequelize,
    modelName: 'finishedSessions',
  });
  return finished_sessions;
};