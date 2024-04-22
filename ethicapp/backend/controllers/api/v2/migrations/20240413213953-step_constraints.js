'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
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
    await queryInterface.addConstraint('sessionsUsers', {
      type: 'foreign key',
      fields: ['sesion_id'],
      references: {
        table: 'sessions',
        field: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });
    await queryInterface.addConstraint('sessionsUsers', {
      type: 'foreign key',
      fields: ['user_id'],
      references: {
        table: 'users',
        field: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });
    // await queryInterface.addConstraint('documents', {
    //   type: 'foreign key',
    //   fields: ['sesion_id'],
    //   references: {
    //     table: 'sessions',
    //     field: 'id'
    //   },
    //   onDelete: 'CASCADE',
    //   onUpdate: 'CASCADE'
    // });   
    // await queryInterface.addConstraint('documents', {
    //   type: 'foreign key',
    //   fields: ['uploader'],
    //   references: {
    //     table: 'users',
    //     field: 'id'
    //   },
    //   onDelete: 'CASCADE',
    //   onUpdate: 'CASCADE'
    // });
    await queryInterface.addConstraint('questions', {
      type: 'foreign key',
      fields: ['sesion_id'],
      references: {
        table: 'sessions',
        field: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });
    // await queryInterface.addConstraint('selections', {
    //   type: 'foreign key',
    //   fields: ['user_id'],
    //   references: {
    //     table: 'users',
    //     field: 'id'
    //   },
    //   onDelete: 'CASCADE',
    //   onUpdate: 'CASCADE'
    // });
    // await queryInterface.addConstraint('selections', {
    //   type: 'foreign key',
    //   fields: ['question_id'],
    //   references: {
    //     table: 'questions',
    //     field: 'id'
    //   },
    //   onDelete: 'CASCADE',
    //   onUpdate: 'CASCADE'
    // });
    await queryInterface.addConstraint('teams', {
      type: 'foreign key',
      fields: ['sesion_id'],
      references: {
        table: 'sessions',
        field: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });
    await queryInterface.addConstraint('teamUsers', {
      type: 'foreign key',
      fields: ['team_id'],
      references: {
        table: 'teams',
        field: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });
    await queryInterface.addConstraint('teamUsers', {
      type: 'foreign key',
      fields: ['user_id'],
      references: {
        table: 'users',
        field: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });
    // Make sure to create the index for the primary key after creating the table.
    // await queryInterface.addConstraint('selections', {
    //   type: 'primary key',
    //   fields: ['user_id', 'question_id']
    // });    
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropAllTables();
    //
  }
};
