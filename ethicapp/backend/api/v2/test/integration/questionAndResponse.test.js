const request = require('supertest');
const app = require('../../testApi'); // Ajusta la ruta según sea necesario
const jwt = require('jsonwebtoken');
const userData = require('../fixtures/users.json')
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

describe('Responses API', () => {
  let token, questionId, phaseId, userId;

  beforeAll(async () => {
    const profesorExample = userData[10]
    const profesorExampleId = await request(app)
        .post(`${API_VERSION_PATH_PREFIX}/users`)
        .send(profesorExample)
    // Autenticar al usuario
    const loginRes = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
      .send({ mail: profesorExample.mail , pass: profesorExample.pass });

    token = loginRes.body.token;
    userId = profesorExampleId.body.data.id;

    // Crear una pregunta para la prueba
    const phaseRes = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/phases`)
      .set('Authorization', `Bearer ${token}`)
      .send({ number: 1, type: 'discussion', anon: false, chat: true, prev_ans: 'Lorem Ipsum', activity_id: 1 });

    phaseId = phaseRes.body.data.id;

    const questionRes = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/questions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        text: '¿Cuál es tu película favorita?',
        content: { question: '¿Cuál es tu película favorita?', options: ['Dune', 'Alien', 'Thor'], correct_answer: 'Thor' },
        additional_info: 'Películas',
        type: 'choice',
        session_id: 1,
        number: 1,
        phase_id: phaseId
      });

    //console.log(questionRes.body)
    questionId = questionRes.body.data.id;
  });

  it('should create a response for a question', async () => {
    const responseData = {
        user_id: userId,
      content: { answer: 'Thor' },
      type: 'choice',
      questionId: questionId
    };

    const res = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/questions/${questionId}/responses`)
      .set('Authorization', `Bearer ${token}`)
      .send(responseData)
      .expect(201);

    expect(res.body.status).toBe('success');
    expect(res.body.data).toHaveProperty('id');
  });

//   it('should update a response for a question', async () => {
//     const responseData = {
//         user_id: userId,
//       content: { answer: 'Thor' },
//       type: 'choice',
//       questionId: questionId
//     };

//     const responseByUser =await request(app)
//       .post(`${API_VERSION_PATH_PREFIX}/questions/${questionId}/responses`)
//       .set('Authorization', `Bearer ${token}`)
//       .send(responseData)
//       .expect(201);
//     console.log(responseByUser)
//     const updateData = {
//         user_id: userId,
//       content: { answer: 'Alien' },
//       type: 'choice',
//       questionId: questionId
//     };

//     const res = await request(app)
//       .put(`${API_VERSION_PATH_PREFIX}/questions/${questionId}/responses`)
//       .set('Authorization', `Bearer ${token}`)
//       .send(updateData)
//       .expect(200);

//     expect(res.body.status).toBe('success');
//     expect(res.body.data.content.answer).toBe('Alien');
//   });

  it('should get all responses for a question', async () => {
    const res = await request(app)
      .get(`${API_VERSION_PATH_PREFIX}/questions/${questionId}/responses`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.status).toBe('success');
    expect(res.body.data).toBeInstanceOf(Array);
  });
});
