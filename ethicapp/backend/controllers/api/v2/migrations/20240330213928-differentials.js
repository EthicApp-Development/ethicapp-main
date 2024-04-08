'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('differentials', {
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
      text_left: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      text_right: {
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
      sesion_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'sessions',
          key: 'id'
        }
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
    await queryInterface.createTable('differentials_selections', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        }
      },
      differential_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'differentials',
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
      created_at: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
    await queryInterface.createTable('differentials_chats', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        }
      },
      differential_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'differentials',
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
      created_at: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
    
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropAllTables();
  }
};