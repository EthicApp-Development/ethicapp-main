'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('differential', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      title: {
        type: Sequelize.TEXT,
        defaultValue: ''
      },
      tleft: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      tright: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      orden: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      creator: {
        type: Sequelize.INTEGER,
        allowNull: true, 
        references: {
          model: 'users',
          key: 'id'
        }
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
    await queryInterface.createTable('differential_selection', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      uid: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        }
      },
      did: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'differential',
          key: 'id'
        }
      },
      sel: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      iteration: {
        type: Sequelize.INTEGER,
        allowNull: true 
      },
      comment: {
        type: Sequelize.TEXT,
        allowNull: true 
      },
      stime: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
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
    await queryInterface.createTable('differential_chat', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      uid: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        }
      },
      did: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'differential',
          key: 'id'
        }
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: true 
      },
      stime: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
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