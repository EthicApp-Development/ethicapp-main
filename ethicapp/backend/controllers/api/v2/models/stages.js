'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Stage extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  Stage.init({
    number: DataTypes.INTEGER,
    type: DataTypes.CHAR(15),
    anon: DataTypes.BOOLEAN,
    chats: DataTypes.BOOLEAN,
    prev_ans: DataTypes.CHAR(255),
    sesion_id: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'Stage',//class
    tableName: 'stages' //Table
  });
  return Stage;
};