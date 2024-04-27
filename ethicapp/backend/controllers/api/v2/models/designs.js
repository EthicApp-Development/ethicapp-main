'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Design extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  Design.init({
    creator: DataTypes.INTEGER,
    design: DataTypes.JSONB,
    public: DataTypes.BOOLEAN,
    locked: DataTypes.BOOLEAN
  }, {
    sequelize,
    modelName: 'Design',//class
    tableName: 'designs'
  });
  return Design;
};