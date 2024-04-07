'use strict';
const {
  Model
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {
      
    }
  }
  User.init({
    name: DataTypes.STRING,
    rut: DataTypes.STRING,
    pass: DataTypes.STRING,
    mail: DataTypes.STRING,
    sex: DataTypes.CHAR(1),
    role: DataTypes.CHAR(1),
  }, {
    sequelize,
    modelName: 'User',
    tableName: 'users',
  });

  class Session extends Model {
    static associate(models) {
      
    }
  }
  Session.init({
    name: DataTypes.STRING,
    descr: DataTypes.TEXT,
    status: DataTypes.INTEGER,
    time: DataTypes.DATE,
    code: DataTypes.STRING(6),
    type: DataTypes.STRING(1),
  }, {
    sequelize,
    modelName: 'Session',
    tableName: 'sessions',
  });

  class SessionsUsers extends Model {
    static associate(models) {
      
    }
  }
  SessionsUsers.init({
    sesid: DataTypes.INTEGER,
    uid: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'SessionsUsers',
    tableName: 'sessions_users',
  });

  class Document extends Model {
    static associate(models) {
      
    }
  }
  Document.init({
    title: DataTypes.TEXT,
    path: DataTypes.TEXT,
    sesid: DataTypes.INTEGER,
    uploader: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'Document',
    tableName: 'documents',
  });

  class Question extends Model {
    static associate(models) {
      
    }
  }
  Question.init({
    content: DataTypes.TEXT,
    options: DataTypes.TEXT,
    answer: DataTypes.INTEGER,
    comment: DataTypes.TEXT,
    other: DataTypes.TEXT,
    sesid: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'Question',
    tableName: 'questions',
  });

  class Selection extends Model {
    static associate(models) {
      
    }
  }
  Selection.init({
    answer: DataTypes.INTEGER,
    uid: DataTypes.INTEGER,
    iteration: { type: DataTypes.INTEGER, defaultValue: 1 },
    comment: DataTypes.TEXT,
    qid: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'Selection',
    tableName: 'selection',
  });

  class Team extends Model {
    static associate(models) {
      
    }
  }
  Team.init({
    sesid: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'Team',
    tableName: 'teams',
  });

  class TeamUser extends Model {
    static associate(models) {
      
    }
  }
  TeamUser.init({
    tmid: DataTypes.INTEGER,
    uid: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'TeamUser',
    tableName: 'teamusers',
  });

  return {
    User,
    Session,
    SessionsUsers,
    Document,
    Question,
    Selection,
    Team,
    TeamUser
  };
};
