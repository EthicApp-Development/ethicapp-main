'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.bulkInsert('drafts', [
      {
        sesion_id: 1,
        data: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        sesion_id: 2,
        data: 'Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas.',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        sesion_id: 2,
        data: 'Nulla facilisi. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Donec velit neque, auctor sit amet aliquam vel, ullamcorper sit amet ligula.',
        created_at: new Date(),
        updated_at: new Date()
      }
    ]);
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('drafts', null, {});
  }
};
