'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Seed data for users table
    await queryInterface.bulkInsert(
      'users',
      [
        {
          id: 1,
          name: 'User 1',
          rut: '12345678-9',
          pass: 'password1',
          mail: 'user1@example.com',
          sex: 'M',
          role: 'U',
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          id: 2,
          name: 'User 2',
          rut: '98765432-1',
          pass: 'password2',
          mail: 'user2@example.com',
          sex: 'F',
          role: 'A',
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          id: 3,
          name: 'profesor',
          rut: '12345678-9',
          pass: 'profesor',
          mail: 'profesor@test.com',
          sex: 'M',
          role: 'U',
          created_at: new Date(),
          updated_at: new Date()
        },
        // Add more users as needed
      ],
      {}
    );

    // Seed data for sessions table
    await queryInterface.bulkInsert(
      'sessions',
      [
        {
          id: 1,
          name: 'Session 1',
          descr: 'Description for session 1',
          status: 1,
          time: new Date(),
          creator: 1, // Assuming user 1 is the creator
          code: 'ABC123',
          type: 'S',
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          id: 2,
          name: 'Session 2',
          descr: 'DESCRIPTION for session 2',
          status: 2,
          time: new Date(),
          creator: 1, // Assuming user 1 is the creator
          code: 'DVS324',
          type: 'S',
          created_at: new Date(),
          updated_at: new Date()
        },
        // Add more sessions as needed
      ],
      {}
    );

    // Seed data for sessions_users table
    await queryInterface.bulkInsert(
      'sessions_users',
      [
        {
          id: 1,
          sesion_id: 1, // Assuming session 1
          user_id: 1, // Assuming user 1
          created_at: new Date(),
          updated_at: new Date()
        },
        // Add more sessions_users as needed
      ],
      {}
    );
    await queryInterface.bulkInsert(
      'documents',
      [
        {
          title: 'Documento 1',
          path: '/path/to/document1.pdf',
          sesion_id: 1,
          uploader: 1,
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          title: 'Documento 2',
          path: '/path/to/document2.pdf',
          sesion_id: 1,
          uploader: 2,
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          title: 'Documento 3',
          path: '/path/to/document3.pdf',
          sesion_id: 2,
          uploader: 1,
          created_at: new Date(),
          updated_at: new Date()
        },
      ],
      {}
    );
    // Seed data for questions table
    await queryInterface.bulkInsert(
      'questions',
      [
        {
          id: 1,
          content: 'Question 1 content',
          options: 'Option 1, Option 2, Option 3',
          answer: 1,
          comment: 'Comment for question 1',
          other: 'Other info for question 1',
          sesion_id: 1, // Assuming session 1
          created_at: new Date(),
          updated_at: new Date()
        },
        // Add more questions as needed
      ],
      {}
    );

    // Seed data for selections table
    await queryInterface.bulkInsert(
      'selections',
      [
        {
          id: 1,
          answer: 2,
          user_id: 1, // Assuming user 1
          iteration: 1,
          comment: 'Comment for selections 1',
          question_id: 1, // Assuming question 1
          created_at: new Date(),
          updated_at: new Date()
        },
        // Add more selections as needed
      ],
      {}
    );

    // Seed data for teams table
    await queryInterface.bulkInsert(
      'teams',
      [
        {
          id: 1,
          sesion_id: 1, // Assuming session 1
          created_at: new Date(),
          updated_at: new Date()
        },
        // Add more teams as needed
      ],
      {}
    );

    // Seed data for teamusers table
    await queryInterface.bulkInsert(
      'teamusers',
      [
        {
          id: 1,
          team_id: 1, // Assuming team 1
          user_id: 1, // Assuming user 1
          created_at: new Date(),
          updated_at: new Date()
        },
        // Add more teamusers as needed
      ],
      {}
    );
  },

  async down(queryInterface, Sequelize) {
    // You might want to implement a down function to remove the seeded data
    // For example, you can use bulkDelete for each table
    await queryInterface.bulkDelete('teamusers', null, {});
    await queryInterface.bulkDelete('teams', null, {});
    await queryInterface.bulkDelete('selections', null, {});
    await queryInterface.bulkDelete('questions', null, {});
    await queryInterface.bulkDelete('sessions_users', null, {});
    await queryInterface.bulkDelete('sessions', null, {});
    await queryInterface.bulkDelete('users', null, {});
  }
};
