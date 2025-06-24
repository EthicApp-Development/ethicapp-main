// tests/integration/activityPhaseTransition.test.js

const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../../testApi');
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

// 1) MOCK antes que nada
jest.mock('../../config/socket.config.js', () => ({
  studentNotifications: {
    phaseTransition: jest.fn(),
  },
}));

// 2) Ahora sí importamos el mock
const { studentNotifications } = require('../../config/socket.config.js');

const userData = require('../fixtures/users.json');

describe('POST /activities/:id/init_next_phase', () => {
  let token, userId, sessionId, designId, activityId;

  beforeAll(async () => {
    const prof = userData[0];
    await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/users`)
      .send({ ...prof, pass_confirmation: prof.pass });

    const login = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
      .send({ mail: prof.mail, pass: prof.pass });

    token = login.body.token;
    userId = login.body.userId;

    const dRes = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/designs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        creator: userId,
        design: {
          phases: [
            { number: 1, anon: false, chat: false, prev_ans: '' },
            { number: 2, anon: false, chat: false, prev_ans: '' }
          ]
        },
        public: true,
        locked: false
      });
    designId = dRes.body.data.id;

    
    const sRes = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/sessions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test Session',
        descr: 'For phase test',
        status: 1,
        type: 'A',
        time: new Date(),
        creator: userId
      });
    sessionId = sRes.body.data.id;

    
    const aRes = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/activities/start`)
      .set('Authorization', `Bearer ${token}`)
      .send({ session: sessionId, design: designId });

    activityId = aRes.body.data.activity.id;
  });

  it('crea la fase 2 y notifica por WebSocket', async () => {
    const res = await request(app)
      .post(
        `${API_VERSION_PATH_PREFIX}/activities/${activityId}/init_next_phase`
      )
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('number', 1);
    expect(res.body.data).toHaveProperty('mode'); 
    
    expect(studentNotifications.phaseTransition).toHaveBeenCalledWith(
      sessionId,
      res.body.data.id
    );
  });
});
