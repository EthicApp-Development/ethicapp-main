'use strict';
const {
  Model
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Design extends Model {
    static associate(models) {
      // Aquí puedes definir las asociaciones con otros modelos si es necesario
    }
  }
  Design.init({
    creator: DataTypes.INTEGER,
    design: DataTypes.JSONB,
    public: DataTypes.BOOLEAN,
    locked: DataTypes.BOOLEAN,
  }, {
    sequelize,
    modelName: 'Design',
    tableName: 'designs',
  });

  class DesignsDocument extends Model {
    static associate(models) {
      // Aquí puedes definir las asociaciones con otros modelos si es necesario
    }
  }
  DesignsDocument.init({
    path: DataTypes.TEXT,
    dsgnid: DataTypes.INTEGER,
    uploader: DataTypes.INTEGER,
    active: DataTypes.BOOLEAN,
  }, {
    sequelize,
    modelName: 'DesignsDocument',
    tableName: 'designs_documents',
  });

  class Activity extends Model {
    static associate(models) {
      // Aquí puedes definir las asociaciones con otros modelos si es necesario
    }
  }
  Activity.init({
    design: DataTypes.INTEGER,
    session: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'Activity',
    tableName: 'activities',
  });

  return {
    Design,
    DesignsDocument,
    Activity,
  };
};
