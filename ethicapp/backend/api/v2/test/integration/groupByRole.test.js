// tests/groupByRole.test.js
const request = require('supertest');
const app = require('../../testApi');
const API = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

const { ActivityRole, ActivityUserRole, Group, groupUser } = require('../../models');

jest.mock('../../config/socket.config.js', () => ({
  studentNotifications: { phaseTransition: jest.fn() }
}));
const { studentNotifications } = require('../../config/socket.config.js');
const userData = require('../fixtures/users.json');

describe('POST /activities/:id/init_next_phase (group by role)', () => {
  let token, userId, sessionId, designId, activityId;

  beforeAll(async () => {
    // --- Crear profesor ---
    const prof = userData[0];
    await request(app).post(`${API}/users`).send({ ...prof, pass_confirmation: prof.pass });
    const login = await request(app).post(`${API}/authenticate_client`)
      .send({ mail: prof.mail, pass: prof.pass });
    token = login.body.token;
    userId = login.body.userId;

    // --- Crear sesión ---
    const sRes = await request(app).post(`${API}/sessions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Session role groups', descr: 'Test byRole', status: 1, type: 'A', time: new Date(), creator: userId });
    sessionId = sRes.body.data.id;

    // --- Crear alumnos y agregarlos ---
    for (let i = 3; i <= 7; i++) {
      const stu = userData[i];
      await request(app).post(`${API}/users`).send({ ...stu, pass_confirmation: stu.pass });
      const stuLogin = await request(app).post(`${API}/authenticate_client`)
        .send({ mail: stu.mail, pass: stu.pass });
      const stuId = stuLogin.body.userId;
      await request(app).post(`${API}/sessions/${sessionId}/users`)
        .send({ user_id: stuId });
    }

    // --- Crear diseño con roles y segunda fase byRole ---
    const dRes = await request(app).post(`${API}/designs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        creator: userId,
        design: {
          roles: [
            { name: 'Leader', description: 'Guía' },
            { name: 'Reporter', description: 'Registra' }
          ],
          phases: [
            { number: 1, mode: 'individual', anonymous: false, chat: false, prevPhasesResponse: [] },
            {
              number: 2,
              mode: 'group',
              anonymous: false,
              chat: false,
              prevPhasesResponse: [],
              stdntAmount: 4,
              grouping_algorithm: 'sameRole',
              heteroQuestionIndex: null
            }
          ]
        },
        public: true,
        locked: false
      });
    designId = dRes.body.data.id;

    // --- Iniciar actividad ---
    const aRes = await request(app).post(`${API}/activities/start`)
      .set('Authorization', `Bearer ${token}`)
      .send({ session: sessionId, design: designId });
    activityId = aRes.body.data.id;
  });

  it('assigns roles and then groups users by role', async () => {
    // --- Fase 1: asignación de roles ---
    const res1 = await request(app).post(`${API}/activities/${activityId}/init_next_phase`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(res1.status).toBe(201);
    expect(res1.body.data.number).toBe(1);

    // Obtener las asignaciones
    const assignments = await ActivityUserRole.findAll({
      where: { activityId },
      attributes: ['RoleId', 'userId'],
      raw: true
    });

    // Mapear los grupos esperados
    const expectedMap = {};
    assignments.forEach(({ RoleId, userId }) => {
      if (!expectedMap[RoleId]) expectedMap[RoleId] = [];
      expectedMap[RoleId].push(userId);
    });

    // --- Fase 2: creación de grupos según rol ---
    const res2 = await request(app).post(`${API}/activities/${activityId}/init_next_phase`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(res2.status).toBe(201);
    expect(res2.body.data.number).toBe(2);

    // Leer grupos de DB
    const groups = await Group.findAll({
      where: { session_id: sessionId },
      attributes: ['id'],
      raw: true
    });

    // Para cada grupo, leer sus users y comparar con expectedMap
    for (const { id: groupId } of groups) {
      const members = await groupUser.findAll({
        where: { group_id: groupId },
        attributes: ['user_id'],
        raw: true
      });
      const userIds = members.map(m => m.user_id).sort();
      // Debe existir un RoleId cuya lista coincida
      expect(Object.values(expectedMap).map(arr => arr.sort()))
        .toContainEqual(userIds);
    }

    // La cantidad de grupos debe igualar la cantidad de roles
    const roles = await ActivityRole.findAll({
      where: { ActivityId: activityId },
      attributes: ['id'],
      raw: true
    });
    expect(groups).toHaveLength(roles.length);
  });
});
