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
    sesid: DataTypes.INTEGER,
    status: DataTypes.INTEGER,
    stime: DataTypes.DATE
  }, {
    sequelize,
    modelName: 'SessionStatus',
    tableName: 'sessionstatus', 
  });

  class FinishedSession extends Model {
    static associate(models) {
      
    }
  }
  FinishedSession.init({
    uid: DataTypes.INTEGER,
    sesid: DataTypes.INTEGER,
    status: DataTypes.INTEGER,
    stime: DataTypes.DATE
  }, {
    sequelize,
    modelName: 'FinishedSession',
    tableName: 'finishedsessions', 
  });

  return {
    SessionStatus,
    FinishedSession
  };
};
