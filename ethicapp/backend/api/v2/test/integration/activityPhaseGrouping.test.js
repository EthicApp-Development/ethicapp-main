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
    for (let i = 1; i <= 5; i++) {
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
              type: 'individual',
              anonymous: false,
              chat: false,
              prevPhasesResponse: []
            },
            {
              number: 2,
              type: 'group',
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

  it('crea la fase grupal y persiste equipos según stdntAmount', async () => {
    const res = await request(app)
      .post(`${API}/activities/${activityId}/init_next_phase`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('number', 2);
    const phaseId = res.body.data.id;

    expect(studentNotifications.phaseTransition)
      .toHaveBeenCalledWith(sessionId, phaseId);

    const phase = await Phase.findByPk(phaseId);
    expect(phase.type).toBe('group');

    const groupRes = await request(app)
      .get(`${API}/group`)
      .set('Authorization', `Bearer ${token}`);

    
    console.log('groupRes', groupRes.body);  
    expect(groupRes.status).toBe(200);
    const groups = groupRes.body.data.filter(g => g.session_id === sessionId);
    expect(groups.length).toBeGreaterThan(0);
  });
});
