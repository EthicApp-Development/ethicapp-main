const request = require('supertest');
const app = require('../../backend/api/v2/testApi'); // Suponiendo que el archivo principal de tu aplicación se llama index.js

const responseData = require('../fixtures/responses.json');
describe('CRUD Operations for Responses API', () => {
  let createdResponseId;

  // Test Create Operation
  it('should create a new response', async () => {
    const newResponseData = responseData[0]

    const response = await request(app)
      .post('/responses')
      .send(newResponseData)
      .expect(201);

    createdResponseId = response.body.id;
  });

  // Test Read Operation
  it('should retrieve all responses', async () => {
    await request(app)
      .get('/responses')
      .expect(200);
  });

  // Test Update Operation
  it('should update an existing response', async () => {
    const updatedResponseData = responseData[1]

    await request(app)
      .put(`/responses/${createdResponseId}`)
      .send(updatedResponseData)
      .expect(200);
  });

  // Test Delete Operation
  it('should delete an existing response', async () => {
    await request(app)
      .delete(`/responses/${createdResponseId}`)
      .expect(204);
  });
  
});
