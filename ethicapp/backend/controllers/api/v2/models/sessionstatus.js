'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class SessionStatus extends Model {
    static associate(models) {
      
    }
  }
  SessionStatus.init({
    sesion_id: DataTypes.INTEGER,
    status: DataTypes.INTEGER,
    stime: DataTypes.DATE
  }, {
    sequelize,
    modelName: 'SessionStatus',
    tableName: 'sessions_status', 
  });

  class FinishedSession extends Model {
    static associate(models) {
      
    }
  }
  FinishedSession.init({
    user_id: DataTypes.INTEGER,
    sesion_id: DataTypes.INTEGER,
    status: DataTypes.INTEGER,
    stime: DataTypes.DATE
  }, {
    sequelize,
    modelName: 'FinishedSession',
    tableName: 'finished_sessions', 
  });

  return {
    SessionStatus,
    FinishedSession
  };
};
