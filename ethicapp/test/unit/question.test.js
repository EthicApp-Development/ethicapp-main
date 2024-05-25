const request = require('supertest');
const app = require('../../backend/api/v2/testApi'); 

const questionData = require('../fixtures/questions.json');
describe('CRUD Operations for Questions API', () => {
  let createdQuestionId;

  // Test Create Operation
  it('should create a new question', async () => {
    console.log("CREATE")
    const newQuestionData = questionData[0]

    const response = await request(app)
      .post('/questions')
      .send(newQuestionData)
      .expect(201);

    createdQuestionId = response.body.data.id;
  });

  // Test Read Operation
  it('should retrieve all questions', async () => {
    console.log("READ")
    await request(app)
      .get('/questions')
      .expect(200);
  });

  // Test Update Operation
  it('should update an existing question', async () => {
    console.log("UPDATE")
    const updatedQuestionData = questionData[1]

    await request(app)
      .put(`/questions/${createdQuestionId}`)
      .send(updatedQuestionData)
      .expect(200);
  });

  // Test Delete Operation
  it('should delete an existing question', async () => {
    console.log("DELETE")
    await request(app)
      .delete(`/questions/${createdQuestionId}`)
      .expect(204);
  });
});