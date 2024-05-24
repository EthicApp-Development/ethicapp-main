'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Phase extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  Phase.init({
    number: DataTypes.INTEGER,
    type: DataTypes.CHAR(15),
    anon: DataTypes.BOOLEAN,
    chat: DataTypes.BOOLEAN,
    prev_ans: DataTypes.CHAR(255),
    activity_id: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'Phase',
    tableName: 'phases'
  });
  return Phase;
};