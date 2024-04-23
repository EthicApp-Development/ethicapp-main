'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class SessionStatus extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  SessionStatus.init({
    sesion_id: DataTypes.INTEGER,
    status: DataTypes.INTEGER,
    stime: DataTypes.DATE,
    state: {
      type: DataTypes.ENUM,
      values: ['new', 'active', 'finished']
    }
  }, {
    sequelize,
    modelName: 'sessionsStatus',
  });
  return SessionStatus;
};