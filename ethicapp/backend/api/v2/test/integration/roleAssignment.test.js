const request = require('supertest');
const app = require('../../testApi');
const API = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

const { ActivityRole, ActivityUserRole, SessionsUsers } = require('../../models');

jest.mock('../../config/socket.config.js', () => ({
  studentNotifications: { phaseTransition: jest.fn() }
}));
const { studentNotifications } = require('../../config/socket.config.js');
const userData = require('../fixtures/users.json');

describe('POST /activities/:id/init_next_phase (roles assignment)', () => {
  let token, userId, sessionId, designId, activityId;

  beforeAll(async () => {
    // Profesor
    const prof = userData[0];
    await request(app)
      .post(`${API}/users`)
      .send({ ...prof, pass_confirmation: prof.pass });

    const login = await request(app)
      .post(`${API}/authenticate_client`)
      .send({ mail: prof.mail, pass: prof.pass });
    token = login.body.token;
    userId = login.body.userId;

    // Crear sesión
    const sRes = await request(app)
      .post(`${API}/sessions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Session for roles test',
        descr: 'Test roles assignment',
        status: 1,
        type: 'A',
        time: new Date(),
        creator: userId
      });
    sessionId = sRes.body.data.id;

    // Crear y agregar alumnos (IDs 3-7)
    for (let i = 3; i <= 7; i++) {
      const stu = userData[i];
      await request(app)
        .post(`${API}/users`)
        .send({ ...stu, pass_confirmation: stu.pass });
      const stuLogin = await request(app)
        .post(`${API}/authenticate_client`)
        .send({ mail: stu.mail, pass: stu.pass });
      const stuId = stuLogin.body.userId;
      await SessionsUsers.create({
        session_id: sessionId,
        user_id: stuId
      });
      
    
    }
    const suRes = await request(app)
        .get(`${API}/sessions/${sessionId}/users`)
        .set('Authorization', `Bearer ${token}`);
        expect(suRes.status).toBe(200);
        expect(Array.isArray(suRes.body.data)).toBe(true);
        expect(suRes.body.data).toHaveLength(5);

    // Crear diseño con roles definidos
    const dRes = await request(app)
      .post(`${API}/designs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        creator: userId,
        design: {
          roles: [
            { name: 'Facilitator', description: 'Leads discussion' },
            { name: 'Secretary',   description: 'Takes notes' }
          ],
          phases: [
            { number: 1, mode: 'individual', anonymous: false, chat: false, prevPhasesResponse: [] },
            { number: 2, mode: 'group',      anonymous: false, chat: false, prevPhasesResponse: [], stdntAmount: 2, grouping_algorithm: 'random', heteroQuestionIndex: null }
          ]
        },
        public: true,
        locked: false
      });
    designId = dRes.body.data.id;

    // Iniciar actividad
    const aRes = await request(app)
      .post(`${API}/activities/start`)
      .set('Authorization', `Bearer ${token}`)
      .send({ session: sessionId, design: designId });
    activityId = aRes.body.data.id;
  });

  it('creates ActivityRole and ActivityUserRole on first phase', async () => {
    const res = await request(app)
      .post(`${API}/activities/${activityId}/init_next_phase`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('number', 1);

    // Verificar ActivityRole
    const roles = await ActivityRole.findAll({ where: { ActivityId: activityId } });
    expect(roles).toHaveLength(2);
    const roleNames = roles.map(r => r.nombre);
    expect(roleNames).toEqual(expect.arrayContaining(['Facilitator', 'Secretary']));

    // Verificar ActivityUserRole
    const assignments = await ActivityUserRole.findAll({ where: { activityId } });
    // Debe haber asignaciones igual al número de usuarios en la sesión
    expect(assignments).toHaveLength(5);
    const assignedUserIds = assignments.map(a => a.userId);
    // Cada usuario debe aparecer al menos una vez
    expect(new Set(assignedUserIds).size).toBe(5);
  });
});
