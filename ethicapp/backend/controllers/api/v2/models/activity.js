'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Activity extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  Activity.init({
    design: DataTypes.INTEGER,
    session: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'Activity',//class
    tableName: 'activities'
  });
  return Activity;
};