'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class documents extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  documents.init({
    title: DataTypes.TEXT,
    path: DataTypes.TEXT,
    sesion_id: DataTypes.INTEGER,
    uploader: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'documents',
  });
  return documents;
};