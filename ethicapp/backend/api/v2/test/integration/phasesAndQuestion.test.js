const request = require('supertest');
const app = require('../../testApi'); // Ajusta la ruta según sea necesario
const jwt = require('jsonwebtoken');
const userData = require('../fixtures/users.json')
const userOnlyDesign = require('../fixtures/onlyDesign.json')
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';
describe('Phases and Questions API', () => {
  let token, phaseId, sessionId;

  beforeAll(async () => {
    // Autenticar al profesor
    const professorExample = userData[11]
    await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/users`)
      .send(professorExample)

    const loginRes = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
      .send({ mail: userData[11].mail, pass: userData[11].pass });

    token = loginRes.body.token;

    // Crear una sesión y actividad para la fase
    await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/designs`)
      .send({
        creator: loginRes.body.userId,
        design: userOnlyDesign[1],
        public: true,
        locked: false
      })
      .set('Authorization', `Bearer ${token}`)
      
    const sessionRes = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/sessions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test Session',
        descr: 'Description',
        status: 1,
        type: 'A',
        creator: loginRes.body.userId,
        time: new Date()
      });

    //console.log(sessionRes.body.data)
    sessionId = sessionRes.body.data.id;

    const phaseRes = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/phases`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        number: 3,
        type: 'discussion',
        anon: false,
        chat: true,
        prev_ans: 'Lorem Ipsum',
        activity_id: sessionRes.body.data.activity.id
      });
    //console.log(phaseRes.body)
    phaseId = phaseRes.body.data.id;
  });

  it('should create a question in the phase', async () => {
    const questionData = {
      text: '¿Cuál es tu película favorita?',
      content: { question: '¿Cuál es tu película favorita?', options: ['Dune', 'Alien', 'Thor'], correct_answer: 'Thor' },
      additional_info: 'Películas',
      type: 'choice',
      session_id: sessionId,
      number: 3,
      phase_id: phaseId
    };

    const res = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/phases/${phaseId}/questions`)
      .set('Authorization', `Bearer ${token}`)
      .send(questionData)
      .expect(201);

    expect(res.body.status).toBe('success');
    expect(res.body.data).toHaveProperty('id');
  });

  it('proof that the number of the question cannot be duplicated in a design', async () => {
    const questionData = {
      text: '¿Cuál es tu película favorita?',
      content: { question: '¿Cuál es tu película favorita?', options: ['Dune', 'Alien', 'Thor'], correct_answer: 'Thor' },
      additional_info: 'Películas',
      type: 'choice',
      session_id: sessionId,
      number: 1,
      phase_id: phaseId
    };

    const res = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/phases/${phaseId}/questions`)
      .set('Authorization', `Bearer ${token}`)
      .send(questionData)

    expect(res.body.status).toBe('error');
    expect(res.status).toBe(400);
  });

  it('should get questions in the phase', async () => {
    const res = await request(app)
      .get(`${API_VERSION_PATH_PREFIX}/phases/${phaseId}/questions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.status).toBe('success');
    expect(res.body.data).toBeInstanceOf(Array);
  });
});
