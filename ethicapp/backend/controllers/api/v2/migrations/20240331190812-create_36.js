'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('designs', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      creator: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        }
      },
      design: {
        type: Sequelize.JSONB,
        allowNull: false
      },
      public: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      locked: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
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
    // await queryInterface.addConstraint('designs', {
    //   type: 'primary key',
    //   fields: ['id'],
    //   name: 'designs_pk'
    // });
    await queryInterface.createTable('designs_documents', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      path: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      dsgnid: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'designs',
          key: 'id'
        }
      },
      uploader: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        }
      },
      active: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
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
    await queryInterface.removeConstraint('designs_documents', 'designs_documents_dsgnid_fkey');
    await queryInterface.addConstraint('designs_documents', {
      fields: ['dsgnid'],
      type: 'foreign key',
      name: 'designs_documents_dsgnid_fkey',
      references: {
        table: 'designs',
        field: 'id'
      },
      onDelete: 'CASCADE'
    });
    await queryInterface.createTable('activity', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      design: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'designs',
          key: 'id'
        }
      },
      session: {
        type: Sequelize.INTEGER,
        allowNull: false,
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
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropAllTables();
  }
};