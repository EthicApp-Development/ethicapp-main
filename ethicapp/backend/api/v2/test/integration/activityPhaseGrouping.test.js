const request = require('supertest');
const app = require('../../testApi');
const API = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

const { Phase } = require('../../models');

jest.mock('../../config/socket.config.js', () => ({
  studentNotifications: { phaseTransition: jest.fn() }
}));
const { studentNotifications } = require('../../config/socket.config.js');

const userData = require('../fixtures/users.json');

describe('POST /activities/:id/init_next_phase (fase grupal)', () => {
  let token, userId, sessionId, designId, activityId;

  beforeAll(async () => {
    const prof = userData[0];
    await request(app)
      .post(`${API}/users`)
      .send({ ...prof, pass_confirmation: prof.pass });

    const login = await request(app)
      .post(`${API}/authenticate_client`)
      .send({ mail: prof.mail, pass: prof.pass });

    token = login.body.token;
    userId = login.body.userId;

    const sRes = await request(app)
      .post(`${API}/sessions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Session para grupo',
        descr: 'Test grouping',
        status: 1,
        type: 'A',
        time: new Date(),
        creator: userId
      });
    sessionId = sRes.body.data.id;

    // Crear alumnos y agregarlos a la sesión con el endpoint real
    for (let i = 3; i <= 7; i++) {
      const stu = userData[i];
      await request(app)
        .post(`${API}/users`)
        .send({ ...stu, pass_confirmation: stu.pass });

      
      const stuLogin = await request(app)
        .post(`${API}/authenticate_client`)
        .send({ mail: stu.mail, pass: stu.pass });
      
      const stuId = stuLogin.body.userId;

      await request(app)
        .post(`${API}/sessions/${sessionId}/users`)
        .send({ user_id: stuId });// debugg
    }

    const dRes = await request(app)
      .post(`${API}/designs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        creator: userId,
        design: {
          phases: [
            {
              number: 1,
              mode: 'individual',
              anonymous: false,
              chat: false,
              prevPhasesResponse: []
            },
            {
              number: 2,
              mode: 'group',
              anonymous: false,
              chat: false,
              prevPhasesResponse: [],
              stdntAmount: 2,
              grouping_algorithm: 'random',
              heteroQuestionIndex: null
            }
          ]
        },
        public: true,
        locked: false
      });
    designId = dRes.body.data.id;

    const aRes = await request(app)
      .post(`${API}/activities/start`)
      .set('Authorization', `Bearer ${token}`)
      .send({ session: sessionId, design: designId });
    activityId = aRes.body.data.activity.id;
  });

  it('primero crea fase individual y luego fase grupal con equipos', async () => {
    // --- fase 1: individual ---
    const res1 = await request(app)
      .post(`${API}/activities/${activityId}/init_next_phase`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(res1.status).toBe(201);
    expect(res1.body.data).toHaveProperty('number', 1);
    expect(res1.body.data).toHaveProperty('mode', 'individual');
    const phase1Id = res1.body.data.id;
    expect(studentNotifications.phaseTransition)
      .toHaveBeenCalledWith(sessionId, phase1Id);

    // --- fase 2: grupal ---
    const res2 = await request(app)
      .post(`${API}/activities/${activityId}/init_next_phase`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(res2.status).toBe(201);
    expect(res2.body.data).toHaveProperty('number', 2);
    expect(res2.body.data).toHaveProperty('mode', 'group');
    const phase2Id = res2.body.data.id;
    expect(studentNotifications.phaseTransition)
      .toHaveBeenCalledWith(sessionId, phase2Id);

    // Verificar persistencia de los grupos
    const groupRes = await request(app)
      .get(`${API}/group`)
      .set('Authorization', `Bearer ${token}`);
    expect(groupRes.status).toBe(200);
    const groups = groupRes.body.data.filter(g => g.session_id === sessionId);
    // Dado stdntAmount = 2 y 5 alumnos, debe haber al menos un grupo
    expect(groups.length).toBeGreaterThan(0);
  });
});