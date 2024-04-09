'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    const designData = {
      title: 'Diseño de ejemplo',
      description: 'Este es un diseño de ejemplo para propósitos de semilla',
      elements: [
        { type: 'text', content: 'Texto de ejemplo' },
        { type: 'image', url: 'https://sequelize.org/docs/v6/' },
        { type: 'chart', data: { labels: ['A', 'B', 'C'], values: [10, 20, 30] } }
      ],
      settings: {
        theme: 'light',
        fontSize: 14,
        colors: { primary: '#007bff', secondary: '#6c757d' }
      }
    };
    
    const serializedDesignData = JSON.stringify(designData);
    
    await queryInterface.bulkInsert('designs', [
      {
        creator: 1,
        design: serializedDesignData,
        public: false,
        locked: false,
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        creator: 2,
        design: serializedDesignData,
        public: true,
        locked: false,
        created_at: new Date(),
        updated_at: new Date()
      },
      // Agrega más datos según sea necesario
    ]);

    // Semilla para la tabla designs_documents
    await queryInterface.bulkInsert('designs_documents', [
      {
        path: '/ruta/al/archivo1.pdf',
        dsgnid: 1,
        uploader: 1,
        active: true,
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        path: '/ruta/al/archivo2.pdf',
        dsgnid: 2,
        uploader: 2,
        active: true,
        created_at: new Date(),
        updated_at: new Date()
      },
      // Agrega más datos según sea necesario
    ]);

    // Semilla para la tabla activities
    await queryInterface.bulkInsert('activities', [
      {
        design: 1,
        session: 1,
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        design: 2,
        session: 2,
        created_at: new Date(),
        updated_at: new Date()
      },
      // Agrega más datos según sea necesario
    ]);
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('activities', null, {});
    await queryInterface.bulkDelete('designs_documents', null, {});
    await queryInterface.bulkDelete('designs', null, {});
  }
};
