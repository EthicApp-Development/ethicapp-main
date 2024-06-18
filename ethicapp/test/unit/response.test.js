const request = require('supertest');
const app = require('../../backend/api/v2/testApi');
const responseData = require('../fixtures/responses.json');
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

describe('CRUD Operations for Responses API', () => {
  let createdResponseId;

  // Test Create Operation
  it('should create a new response', async () => {
    const newResponseData = responseData[0]

    const response = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/responses`)
      .send(newResponseData)
      .expect(201);

    createdResponseId = response.body.data.id;
  });

  // Test Read Operation
  it('should retrieve all responses', async () => {
    await request(app)
      .get(`${API_VERSION_PATH_PREFIX}/responses`)
      .expect(200);
  });

  // Test Update Operation
  it('should update an existing response', async () => {
    const updatedResponseData = responseData[1]

    await request(app)
      .put(`${API_VERSION_PATH_PREFIX}/responses/${createdResponseId}`)
      .send(updatedResponseData)
      .expect(200);
  });

  // Test Delete Operation
  it('should delete an existing response', async () => {
    await request(app)
      .delete(`${API_VERSION_PATH_PREFIX}/responses/${createdResponseId}`)
      .expect(204);
  });
  
});
