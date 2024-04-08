// report_activity.js
'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ReportActivity extends Model {
    static associate(models) {
      
    }
  }
  ReportActivity.init({
    creation_date: DataTypes.DATE,
    professor: DataTypes.INTEGER,
    count: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'ReportActivity',
    tableName: 'report_activity',
  });

  return ReportActivity;
};

// report_create_account.js
'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ReportCreateAccount extends Model {
    static associate(models) {
      
    }
  }
  ReportCreateAccount.init({
    creation_date: DataTypes.DATE,
    is_teacher: DataTypes.BOOLEAN,
    count: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'ReportCreateAccount',
    tableName: 'report_create_account',
  });

  return ReportCreateAccount;
};

// report_login.js
'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ReportLogin extends Model {
    static associate(models) {
      
    }
  }
  ReportLogin.init({
    login_date: DataTypes.DATE,
    is_teacher: DataTypes.BOOLEAN,
    count: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'ReportLogin',
    tableName: 'report_login',
  });

  return ReportLogin;
};

// report_type.js
'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ReportType extends Model {
    static associate(models) {
      
    }
  }
  ReportType.init({
    report_type: DataTypes.TEXT,
    report_description: DataTypes.TEXT,
  }, {
    sequelize,
    modelName: 'ReportType',
    tableName: 'report_type',
  });

  return ReportType;
};
