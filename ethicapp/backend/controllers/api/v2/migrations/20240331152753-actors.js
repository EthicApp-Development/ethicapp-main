'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('stages', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      number: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      type: {
        type: Sequelize.CHAR(15),
        allowNull: false
      },
      anon: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      chats: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      prev_ans: {
        type: Sequelize.CHAR(255),
        allowNull: true
      },
      sesid: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'sessions',
          key: 'id'
        }
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
    await queryInterface.createTable('actors', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      name: {
        type: Sequelize.CHAR(255),
        allowNull: false
      },
      jorder: {
        type: Sequelize.BOOLEAN,
        allowNull: false
      },
      stageid: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'stages',
          key: 'id'
        }
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
    await queryInterface.createTable('actors_selections', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      orden: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      actorid: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'actors',
          key: 'id'
        }
      },
      uid: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        }
      },
      stageid: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'stages',
          key: 'id'
        }
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropAllTables();
  }
};