'use strict';
const {
  Model
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class AddColumnsAndConstraint extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {

    }
  }
  AddColumnsAndConstraint.init({
    id: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'AddColumnsAndConstraint',
  });

  AddColumnsAndConstraint.addHook('afterSync', (models) => {
    const { User, Document } = models;
    
   
    sequelize.queryInterface.addColumn('teams', 'original_leader', {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: User,
        key: 'id'
      }
    });
    sequelize.queryInterface.addConstraint('teams', {
      type: 'foreign key',
      fields: ['original_leader'],
      references: {
        table: 'users',
        field: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });

    sequelize.queryInterface.addColumn('documents', 'active', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    });
  });

  return AddColumnsAndConstraint;
};
