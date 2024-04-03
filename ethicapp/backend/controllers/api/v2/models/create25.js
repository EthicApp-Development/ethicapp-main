'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class create25 extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  create25.init({
    number: DataTypes.INTEGER,
    type: DataTypes.STRING,
    anon: DataTypes.BOOLEAN,
    chat: DataTypes.BOOLEAN,
    prev_ans: DataTypes.STRING
  }, {
    sequelize,
    modelName: 'create25',
  });
  return create25;
};