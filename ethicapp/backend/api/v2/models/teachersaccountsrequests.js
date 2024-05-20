'use strict';
const {
  Model
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class TeacherAccountRequest extends Model {
    static associate(models) {
      
    }
  }
  TeacherAccountRequest.init({
    name: DataTypes.TEXT,
    rut: DataTypes.TEXT,
    pass: DataTypes.TEXT,
    mail: DataTypes.TEXT,
    gender: DataTypes.CHAR(1),
    institution: DataTypes.TEXT,
    date: {
      type: DataTypes.DATE,
      defaultValue: sequelize.literal('CURRENT_TIMESTAMP'),
    },
    status: DataTypes.CHAR(1),
    reject_reason: DataTypes.TEXT,
    upgrade_flag: DataTypes.BOOLEAN,
  }, {
    sequelize,
    modelName: 'TeacherAccountRequest',//class
    tableName: 'teacher_account_requests', //Table
  });

  return TeacherAccountRequest;
};
