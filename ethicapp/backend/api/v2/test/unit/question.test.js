const request = require('supertest');
const app = require('../../testApi');
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';
const userData = require('../fixtures/users.json')
const questionData = require('../fixtures/questions.json');

describe('CRUD Operations for Questions API', () => {
  let createdQuestionId;
  let userToken
  let design
  beforeAll(async () => {
    const profesorExample = userData[10]
    const profesorExampleId = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/users`)
      .send(profesorExample)

    const loginRes = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
      .send({ mail: profesorExample.mail, pass: profesorExample.pass });

    userToken = loginRes.body.token;
  })
  // Test Create Operation
  it('should create a new question', async () => {
    //console.log("CREATE")
    const newQuestionData = questionData[0]

    const question = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/questions`)
      .send(newQuestionData)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(201);

    createdQuestionId = question.body.data.id;
  });

  // Test Read Operation
  it('should retrieve all questions', async () => {
    //console.log("READ")
    await request(app)
      .get(`${API_VERSION_PATH_PREFIX}/questions`)
      .expect(200);
  });

  // Test Update Operation
  it('should update an existing question', async () => {
    //console.log("UPDATE")
    const updatedQuestionData = questionData[1]

    await request(app)
      .put(`${API_VERSION_PATH_PREFIX}/questions/${createdQuestionId}`)
      .send(updatedQuestionData)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
  });

  // Test Delete Operation
  it('should delete an existing question', async () => {
    //console.log("DELETE")
    await request(app)
      .delete(`${API_VERSION_PATH_PREFIX}/questions/${createdQuestionId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(204);
  });

  // Test Error Delete Operation
  it('should delete an existing question', async () => {
    //console.log("DELETE")
    await request(app)
      .delete(`${API_VERSION_PATH_PREFIX}/questions/99999999`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(404);
  });
});
