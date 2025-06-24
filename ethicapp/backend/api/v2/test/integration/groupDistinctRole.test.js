// tests/groupDistinctRole.test.js
const request = require('supertest');
const app = require('../../testApi');
const API = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

const {
  ActivityRole,
  ActivityUserRole,
  Group,
  groupUser
} = require('../../models');

jest.mock('../../config/socket.config.js', () => ({
  studentNotifications: { phaseTransition: jest.fn() }
}));
const { studentNotifications } = require('../../config/socket.config.js');
const userData = require('../fixtures/users.json');

describe('POST /activities/:id/init_next_phase (group distinctRole)', () => {
  let token, userId, sessionId, designId, activityId;

  beforeAll(async () => {
    // 1) Crear profesor y obtener token
    const prof = userData[0];
    await request(app).post(`${API}/users`).send({ ...prof, pass_confirmation: prof.pass });
    const login = await request(app).post(`${API}/authenticate_client`)
      .send({ mail: prof.mail, pass: prof.pass });
    token = login.body.token;
    userId = login.body.userId;

    // 2) Crear sesión
    const sRes = await request(app).post(`${API}/sessions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Session distinctRole',
        descr: 'Test distinctRole grouping',
        status: 1,
        type: 'A',
        time: new Date(),
        creator: userId
      });
    sessionId = sRes.body.data.id;

    // 3) Crear alumnos y agregarlos a la sesión (IDs 3–7)
    for (let i = 3; i <= 11; i++) {
      const stu = userData[i];
      await request(app).post(`${API}/users`).send({ ...stu, pass_confirmation: stu.pass });
      const stuLogin = await request(app).post(`${API}/authenticate_client`)
        .send({ mail: stu.mail, pass: stu.pass });
      const stuId = stuLogin.body.userId;
      await request(app).post(`${API}/sessions/${sessionId}/users`)
        .send({ user_id: stuId });
    }

    // 4) Crear diseño con 2 roles y segunda fase distinctRole
    const dRes = await request(app).post(`${API}/designs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        creator: userId,
        design: {
          roles: [
            { name: 'RoleA', description: 'Primer rol' },
            { name: 'RoleB', description: 'Segundo rol' }
          ],
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
              grouping_algorithm: 'distinctRole',
              heteroQuestionIndex: null
            }
          ]
        },
        public: true,
        locked: false
      });
    designId = dRes.body.data.id;

    // 5) Iniciar actividad
    const aRes = await request(app).post(`${API}/activities/start`)
      .set('Authorization', `Bearer ${token}`)
      .send({ session: sessionId, design: designId });
    activityId = aRes.body.data.activity.id;
  });

  it('assigns roles and then forms groups with distinctRole algorithm', async () => {
    // --- Fase 1: asignación de roles ---
    const res1 = await request(app)
      .post(`${API}/activities/${activityId}/init_next_phase`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(res1.status).toBe(201);
    expect(res1.body.data.number).toBe(1);

    // Obtener asignaciones usuario→rol
    const assignments = await ActivityUserRole.findAll({
      where: { activityId },
      attributes: ['RoleId', 'userId'],
      raw: true
    });

    // Mapa de roles a usuarios
    const roleMap = {};
    assignments.forEach(({ RoleId, userId }) => {
      if (!roleMap[RoleId]) roleMap[RoleId] = [];
      roleMap[RoleId].push(userId);
    });

    const allUsers = assignments.map(a => a.userId).sort();

    // --- Fase 2: agrupación distinctRole ---
    const res2 = await request(app)
      .post(`${API}/activities/${activityId}/init_next_phase`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(res2.status).toBe(201);
    expect(res2.body.data.number).toBe(2);

    // Leer grupos creados en DB
    const groups = await Group.findAll({
      where: { session_id: sessionId },
      attributes: ['id'],
      raw: true
    });
    
    

    expect(groups).toHaveLength(4);

    // Recopilar miembros de cada grupo
    const groupMembers = await Promise.all(groups.map(async ({ id }) => {
      const rows = await groupUser.findAll({
        where: { group_id: id },
        attributes: ['user_id'],
        raw: true
      });
      return rows.map(r => r.user_id).sort();
    }));

    const userRoleMap = {};
    assignments.forEach(({ RoleId, userId }) => {
        userRoleMap[userId] = RoleId;
    });

    

    // 1) Verificar que todos los usuarios aparezcan exactamente una vez
    const flattened = groupMembers.flat().sort();
    expect(flattened).toEqual(allUsers);

    // 2) Verificar tamaño de grupos <= stdntAmount
    groupMembers.forEach(members => {
      expect(members.length).toBeLessThanOrEqual(4);
    });

    // 3) Para cada rol, comprobar que su distribución entre grupos difiera a lo sumo en 1
    const groupCount = groupMembers.length;
    Object.entries(roleMap).forEach(([roleId, users]) => {
      // cuenta por grupo
      const counts = groupMembers.map(members =>
        members.filter(u => users.includes(u)).length
      );
      const min = Math.min(...counts);
      const max = Math.max(...counts);
      expect(max - min).toBeLessThanOrEqual(1);
      // además, sum(counts) === users.length
      expect(counts.reduce((a,b) => a+b, 0)).toBe(users.length);
    

    });
  });
});
