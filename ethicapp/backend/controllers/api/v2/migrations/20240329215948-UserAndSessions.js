'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('users', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      name: {
        type: Sequelize.STRING,
        allowNull:true
      },
      rut: {
        type: Sequelize.STRING,
        allowNull:true
      },
      pass: {
        type: Sequelize.STRING,
        allowNull:true
      },
      mail: {
        type: Sequelize.STRING,
        allowNull:true
      },
      sex: {
        type: Sequelize.CHAR(1)
      },
      role: {
        type: Sequelize.CHAR(1)
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
    await queryInterface.createTable('sessions', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      descr: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      status: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      time: {
        type: Sequelize.DATE,
        allowNull: true
      },
      creator: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id'
        }
      },
      code: {
        type: Sequelize.STRING(6),
        allowNull: true
      },
      type: {
        type: Sequelize.STRING(1),
        allowNull: true
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
    await queryInterface.createTable('sessions_users', {
      id: {
        allowNull: false,
        autoIncrement: true,
        type: Sequelize.INTEGER
      },
      sesid: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'sessions',
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
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
    await queryInterface.createTable('documents', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      title: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      path: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      sesid: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'sessions',
          key: 'id'
        }
      },
      uploader: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
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
    await queryInterface.createTable('questions', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      options: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      answer: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      comment: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      other: {
        type: Sequelize.TEXT,
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
    await queryInterface.createTable('selection', {
      id: {
        allowNull: false,
        autoIncrement: true,
        type: Sequelize.INTEGER
      },
      answer: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      uid: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        }
      },
      iteration: {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: 1
      },
      comment: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      qid: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'questions',
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
    await queryInterface.createTable('teams', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      sesid: {
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
    await queryInterface.createTable('teamusers', {
      id: {
        allowNull: false,
        autoIncrement: true,
        type: Sequelize.INTEGER
      },
      tmid: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'teams',
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
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
    // Make sure you create the index for the foreign key after creating the table.
    await queryInterface.addConstraint('sessions', {
      type: 'foreign key',
      fields: ['creator'],
      references: {
        table: 'users',
        field: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });
    await queryInterface.addConstraint('sessions_users', {
      type: 'foreign key',
      fields: ['sesid'],
      references: {
        table: 'sessions',
        field: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });
    await queryInterface.addConstraint('sessions_users', {
      type: 'foreign key',
      fields: ['uid'],
      references: {
        table: 'users',
        field: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });
    await queryInterface.addConstraint('documents', {
      type: 'foreign key',
      fields: ['sesid'],
      references: {
        table: 'sessions',
        field: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });   
    await queryInterface.addConstraint('documents', {
      type: 'foreign key',
      fields: ['uploader'],
      references: {
        table: 'users',
        field: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });
    await queryInterface.addConstraint('questions', {
      type: 'foreign key',
      fields: ['sesid'],
      references: {
        table: 'sessions',
        field: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });
    await queryInterface.addConstraint('selection', {
      type: 'foreign key',
      fields: ['uid'],
      references: {
        table: 'users',
        field: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });
    await queryInterface.addConstraint('selection', {
      type: 'foreign key',
      fields: ['qid'],
      references: {
        table: 'questions',
        field: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });
    await queryInterface.addConstraint('teams', {
      type: 'foreign key',
      fields: ['sesid'],
      references: {
        table: 'sessions',
        field: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });
    await queryInterface.addConstraint('teamusers', {
      type: 'foreign key',
      fields: ['tmid'],
      references: {
        table: 'teams',
        field: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });
    await queryInterface.addConstraint('teamusers', {
      type: 'foreign key',
      fields: ['uid'],
      references: {
        table: 'users',
        field: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });
    // Make sure to create the index for the primary key after creating the table.
    await queryInterface.addConstraint('selection', {
      type: 'primary key',
      fields: ['uid', 'qid']
    });    
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropAllTables();
  }
};
