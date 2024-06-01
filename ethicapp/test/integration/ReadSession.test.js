const request = require('supertest');
const app = require('../../backend/api/v2/testApi'); // Ajusta según tu configuración
const { User, Session, SessionsUsers } = require('../../backend/api/v2/models');
const jwt = require('jsonwebtoken');
const addUser = require('../fixtures/users.json');
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

describe('GET /sessions/:sessionId/users', () => {
  let adminToken, professorToken, studentToken, sessionId, professorFalseToken;

  beforeAll(async () => {
    // Crea un usuario administrador
    const adminUser = addUser[0];
    const admin = await User.create(adminUser);

    // Crea un usuario profesor
    const profesorUser = addUser[4];
    const professor = await User.create(profesorUser);

    // profesor falso
    const ProfesorUserFalse = addUser[5];
    const professorFalso = await User.create(ProfesorUserFalse);

    // Crea un usuario estudiante
    const estudentUser = addUser[3];
    const student = await User.create(estudentUser);

    // Genera tokens para cada usuario
    adminToken = jwt.sign({ id: admin.id, role: admin.role }, 'your_secret_key');
    professorToken = jwt.sign({ id: professor.id, role: professor.role }, 'your_secret_key');
    professorFalseToken = jwt.sign({ id: professorFalso.id, role: professorFalso.role }, 'your_secret_key');
    studentToken = jwt.sign({ id: student.id, role: student.role }, 'your_secret_key');

    // Crea una sesión y asigna al profesor como creador
    const session = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/sessions`)
      .set('Authorization', `Bearer ${professorToken}`)
      .send({ name: `Test Session Read ${professor.name}-${professor.id}`, descr: 'A session for testing Read', time: new Date(), creator: professor.id, type: 'A', status: 1 });

    sessionId = session.body.data.id;

    // Añade al profesor y al estudiante a la sesión
    await SessionsUsers.bulkCreate([
      { session_id: sessionId, user_id: professor.id },
      { session_id: sessionId, user_id: student.id },
    ]);
  });

  it('should return 401 if no token is provided', async () => {
    const res = await request(app).get(`${API_VERSION_PATH_PREFIX}/sessions/${sessionId}/users`);
    expect(res.status).toBe(401);
  });

  it('should allow admin to access the session users', async () => {
    const res = await request(app)
      .get(`${API_VERSION_PATH_PREFIX}/sessions/${sessionId}/users`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2); // Profesor y estudiante
  });

  it('should allow the creator professor to access the session users', async () => {
    const res = await request(app)
      .get(`${API_VERSION_PATH_PREFIX}/sessions/${sessionId}/users`)
      .set('Authorization', `Bearer ${professorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2); // Profesor y estudiante
  });

  it('should return 403 for a student trying to access session users', async () => {
    const res = await request(app)
      .get(`${API_VERSION_PATH_PREFIX}/sessions/${sessionId}/users`)
      .set('Authorization', `Bearer ${studentToken}`);
    expect(res.status).toBe(403);
  });

  it('should not allow the teacher who is not from this session to access the users of the session', async () => {
    const res = await request(app)
      .get(`${API_VERSION_PATH_PREFIX}/sessions/${sessionId}/users`)
      .set('Authorization', `Bearer ${professorFalseToken}`);
    expect(res.status).toBe(403);
  });
});
