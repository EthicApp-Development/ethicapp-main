'use strict';
const {
  Model
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Draft extends Model {
    static associate(models) {
      // Aquí puedes definir las asociaciones con otros modelos si es necesario
    }
  }
  Draft.init({
    sesid: DataTypes.INTEGER,
    data: DataTypes.TEXT,
  }, {
    sequelize,
    modelName: 'Draft',
    tableName: 'drafts',
  });

  return Draft;
};
