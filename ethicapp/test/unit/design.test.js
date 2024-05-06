const request = require('supertest');
const app = require('../../backend/api/v2/index'); // Suponiendo que el archivo principal de tu aplicación se llama index.js

const designsData = require('../fixtures/designs.json');
describe('CRUD Operations for Designs API', () => {
  let createdDesignId;
  console.log("--- CRUD testing Design ---")
  // Test Create Operation
  it('should create a new design', async () => {
    const newDesignData = designsData[0]

    const response = await request(app)
      .post('/designs')
      .send(newDesignData)
      .expect(201);

    createdDesignId = response.body.id; // Suponiendo que tu API devuelve el ID del diseño creado

  });

  // Test Read Operation
  it('should retrieve all designs', async () => {
    await request(app)
      .get('/designs')
      .expect(200);
  });

  // Test Update Operation
  it('should update an existing design', async () => {
    const updatedDesignData = designsData[1]

    await request(app)
      .put(`/designs/${createdDesignId}`)
      .send(updatedDesignData)
      .expect(200);
  });

  // Test Delete Operation
  it('should delete an existing design', async () => {
    await request(app)
      .delete(`/designs/${createdDesignId}`)
      .expect(204);
  });
  
});
