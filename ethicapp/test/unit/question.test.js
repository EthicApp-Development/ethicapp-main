const request = require('supertest');
const app = require('../../backend/api/v2/testApi'); // Suponiendo que el archivo principal de tu aplicación se llama index.js

const questionData = require('../fixtures/questions.json');
describe('CRUD Operations for Questions API', () => {
  let createdQuestionId;

  // Test Create Operation
  it('should create a new question', async () => {
    const newQuestionData = questionData[0]

    const response = await request(app)
      .post('/questions')
      .send(newQuestionData)
      .expect(201);

    createdQuestionId = response.body.id;
  });

  // Test Read Operation
  it('should retrieve all questions', async () => {
    await request(app)
      .get('/questions')
      .expect(200);
  });

  // Test Update Operation
  it('should update an existing question', async () => {
    const updatedQuestionData = questionData[1]

    await request(app)
      .put(`/questions/${createdQuestionId}`)
      .send(updatedQuestionData)
      .expect(200);
  });

  // Test Delete Operation
  it('should delete an existing question', async () => {
    await request(app)
      .delete(`/questions/${createdQuestionId}`)
      .expect(204);
  });
});
