'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class designs extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  designs.init({
    creator: DataTypes.INTEGER,
    design: DataTypes.JSONB,
    public: DataTypes.BOOLEAN,
    locked: DataTypes.BOOLEAN
  }, {
    sequelize,
    modelName: 'designs',
  });
  return designs;
};