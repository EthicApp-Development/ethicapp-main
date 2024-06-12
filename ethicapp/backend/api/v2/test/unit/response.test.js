const request = require('supertest');
const app = require('../../testApi');
const responseData = require('../fixtures/responses.json');
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

describe('CRUD Operations for Responses API', () => {
  let createdResponseId;

  // Test Create Operation
  it('should create a new response', async () => {
    const newResponseData = {
      user_id: 2,
      content: {
        respuesta: "Esta es la respuesta a la pregunta"
      },
      type: "Example",
      question_id: 3
    };

    const response = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/responses`)
      .send(newResponseData)
      .expect(201);

    createdResponseId = response.body.data.id;
    expect(response.body.data).toHaveProperty('id');
  });

  // Test Read Operation
  it('should retrieve all responses', async () => {
    const response = await request(app)
      .get(`${API_VERSION_PATH_PREFIX}/responses`)
      .expect(200);

    expect(response.body.data).toBeInstanceOf(Array);
  });

  // Test Update Operation
  it('should update an existing response', async () => {
    const updatedResponseData = {
      user_id: 2,
      content: {
        respuesta: "Esta es la respuesta actualizada a la pregunta"
      },
      type: "Example",
      question_id: 3
    };

    const response = await request(app)
      .put(`${API_VERSION_PATH_PREFIX}/responses/${createdResponseId}`)
      .send(updatedResponseData)
      .expect(200);

    expect(response.body.data.content.respuesta).toBe("Esta es la respuesta actualizada a la pregunta");
  });

  // Test Delete Operation
  it('should delete an existing response', async () => {
    await request(app)
      .delete(`${API_VERSION_PATH_PREFIX}/responses/${createdResponseId}`)
      .expect(204);
  });
});
