'use strict';
const {
  Model
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Draft extends Model {
    static associate(models) {
      
    }
  }
  Draft.init({
    session_id: DataTypes.INTEGER,
    data: DataTypes.TEXT,
  }, {
    sequelize,
    modelName: 'Draft',
    tableName: 'drafts',
  });

  return Draft;
};
