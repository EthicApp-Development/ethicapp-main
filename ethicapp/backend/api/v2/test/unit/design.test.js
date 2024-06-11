const request = require('supertest');
const app = require('../../testApi'); 
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

const designsData = require('../fixtures/designs.json');
describe('CRUD Operations for Designs API', () => {
  let createdDesignId;
  //console.log("--- CRUD testing Design ---")
  // Test Create Operation
  it('should create a new design', async () => {
    const newDesignData = designsData[0]
    console.log(designsData[1].design.phase[1])
    const response = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/designs`)
      .send(newDesignData)
      .expect(201);

    createdDesignId = response.body.data.id;

  });

  // Test Read Operation
  it('should retrieve all designs', async () => {
    await request(app)
      .get(`${API_VERSION_PATH_PREFIX}/designs`)
      .expect(200);
  });

  // Test Update Operation
  it('should update an existing design', async () => {
    const updatedDesignData = designsData[1]

    await request(app)
      .put(`${API_VERSION_PATH_PREFIX}/designs/${createdDesignId}`)
      .send(updatedDesignData)
      .expect(200);
  });

  // Test Delete Operation
  it('should delete an existing design', async () => {
    await request(app)
      .delete(`${API_VERSION_PATH_PREFIX}/designs/${createdDesignId}`)
      .expect(204);
  });
  
});
