'use strict';
const {
  Model
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class addcolumnstotables extends Model {
    static associate(models) {
      // Define las asociaciones aquí si es necesario
    }
  }
  addcolumnstotables.init({
    id: DataTypes.INTEGER,
    progress: DataTypes.INTEGER, // Agregar el campo progress
    confidence: DataTypes.INTEGER, // Agregar el campo confidence
    options: DataTypes.STRING(16), // Agregar el campo options
    plugin_data: DataTypes.STRING(255), // Agregar el campo plugin_data
    cpid: DataTypes.INTEGER, // Agregar el campo cpid
    lang: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'spanish'
    } // Agregar el campo lang
  }, {
    sequelize,
    modelName: 'addcolumnstotables',
  });
  return addcolumnstotables;
};
