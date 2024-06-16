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
    const professorExample = userData[9]
    await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/users`)
      .send(professorExample)

    const loginRes = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
      .send({ mail: userData[9].mail, pass: userData[9].pass });

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

    console.log(sessionRes.body.data)
    sessionId = sessionRes.body.data.id;

    //activity is not necessary at this stage as the session creates the activity
    // const activityRes = await request(app)
    //   .post(`${API_VERSION_PATH_PREFIX}/activity`)
    //   .set('Authorization', `Bearer ${token}`)
    //   .send({ design: 1, session: sessionId });

    const phaseRes = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/phases`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        number: 1,
        type: 'discussion',
        anon: false,
        chat: true,
        prev_ans: 'Lorem Ipsum',
        activity_id: sessionRes.body.data.activity.id
      });

    phaseId = phaseRes.body.data.id;
  });

  it('should create a question in the phase', async () => {
    const questionData = {
      text: '¿Cuál es tu película favorita?',
      content: { question: '¿Cuál es tu película favorita?', options: ['Dune', 'Alien', 'Thor'], correct_answer: 'Thor' },
      additional_info: 'Películas',
      type: 'choice',
      session_id: sessionId,
      number: 1
    };

    const res = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/phases/${phaseId}/questions`)
      .set('Authorization', `Bearer ${token}`)
      .send(questionData)
      .expect(201);

    expect(res.body.status).toBe('success');
    expect(res.body.data).toHaveProperty('id');
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
